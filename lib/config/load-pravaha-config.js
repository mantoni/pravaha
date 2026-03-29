/* eslint-disable max-lines */
/** @import { JsonReadResult, ValidationDiagnostic } from '../shared/types/validation.types.ts' */

import { join } from 'node:path';

import {
  createDiagnostic,
  isPlainObject,
  readJsonFile,
} from '../shared/diagnostics/validation-helpers.js';

const DEFAULT_PLUGIN_DIRECTORY = 'plugins';
const DEFAULT_ROOT_FLOW_LABEL = 'Root flow';
const PRAVAHA_CONFIG_FILENAME = 'pravaha.json';
const DEFAULT_QUEUE_DIRECTORY = '.pravaha/queue.git';
const DEFAULT_QUEUE_UPSTREAM_REMOTE = 'origin';
const DEFAULT_QUEUE_TARGET_BRANCH = 'main';
const DEFAULT_QUEUE_READY_REF_PREFIX = 'refs/queue/ready';
const DEFAULT_QUEUE_CANDIDATE_REF = 'refs/queue/candidate/current';
const DEFAULT_QUEUE_BASE_REF = 'refs/queue/meta/base';

export { loadPravahaConfig, normalizePravahaConfig };

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   config: ReturnType<typeof normalizePravahaConfig>,
 *   diagnostics: ValidationDiagnostic[],
 *   file_path: string,
 *   json_result: JsonReadResult,
 * }>}
 */
async function loadPravahaConfig(repo_directory) {
  const pravaha_config_path = join(repo_directory, PRAVAHA_CONFIG_FILENAME);
  const json_result = await readJsonFile(pravaha_config_path);
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [...json_result.diagnostics];
  const config = normalizePravahaConfig(
    json_result.value,
    pravaha_config_path,
    diagnostics,
  );

  return {
    config,
    diagnostics,
    file_path: pravaha_config_path,
    json_result,
  };
}

/**
 * @param {unknown} pravaha_config_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{
 *   flow_config: {
 *     default_matches: string[],
 *     root_flow_label: string,
 *   },
 *   plugin_config: {
 *     dir: string,
 *   },
 *   queue_config: {
 *     base_ref: string,
 *     candidate_ref: string,
 *     dir: string,
 *     ready_ref_prefix: string,
 *     target_branch: string,
 *     upstream_remote: string,
 *     validation_flow: string | null,
 *   },
 *   semantic_roles: unknown,
 *   semantic_states: unknown,
 * }}
 */
function normalizePravahaConfig(
  pravaha_config_value,
  pravaha_config_path,
  diagnostics,
) {
  const pravaha_config_object = isPlainObject(pravaha_config_value)
    ? pravaha_config_value
    : {};

  return {
    flow_config: resolveFlowConfig(
      pravaha_config_object.flows,
      pravaha_config_path,
      diagnostics,
    ),
    plugin_config: resolvePluginConfig(
      pravaha_config_object.plugins,
      pravaha_config_path,
      diagnostics,
    ),
    queue_config: resolveQueueConfig(
      pravaha_config_object.queue,
      pravaha_config_path,
      diagnostics,
    ),
    semantic_roles: pravaha_config_object.semantic_roles,
    semantic_states: pravaha_config_object.semantic_states,
  };
}

/**
 * @param {unknown} flows_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{ default_matches: string[], root_flow_label: string }}
 */
function resolveFlowConfig(flows_value, pravaha_config_path, diagnostics) {
  /** @type {{ default_matches: string[], root_flow_label: string }} */
  const flow_config = {
    default_matches: [],
    root_flow_label: DEFAULT_ROOT_FLOW_LABEL,
  };

  if (flows_value === undefined) {
    return flow_config;
  }

  if (!isPlainObject(flows_value)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config flows must be an object when present.',
      ),
    );

    return flow_config;
  }

  if (Array.isArray(flows_value.default_matches)) {
    if (flows_value.default_matches.every(isNonEmptyString)) {
      flow_config.default_matches = [...flows_value.default_matches];
    } else {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          'Pravaha config flows.default_matches must be an array of non-empty strings when present.',
        ),
      );
    }
  } else if (flows_value.default_matches !== undefined) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config flows.default_matches must be an array of non-empty strings when present.',
      ),
    );
  }

  if (typeof flows_value.root_flow_label === 'string') {
    if (flows_value.root_flow_label.trim() !== '') {
      flow_config.root_flow_label = flows_value.root_flow_label;
    } else {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          'Pravaha config flows.root_flow_label must be a non-empty string when present.',
        ),
      );
    }
  } else if (flows_value.root_flow_label !== undefined) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config flows.root_flow_label must be a non-empty string when present.',
      ),
    );
  }

  return flow_config;
}

/**
 * @param {unknown} plugins_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{ dir: string }}
 */
function resolvePluginConfig(plugins_value, pravaha_config_path, diagnostics) {
  if (plugins_value === undefined) {
    return {
      dir: DEFAULT_PLUGIN_DIRECTORY,
    };
  }

  if (!isPlainObject(plugins_value)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config plugins.dir must be a non-empty string when present.',
      ),
    );

    return {
      dir: DEFAULT_PLUGIN_DIRECTORY,
    };
  }

  if (plugins_value.dir === undefined) {
    return {
      dir: DEFAULT_PLUGIN_DIRECTORY,
    };
  }

  if (!isNonEmptyString(plugins_value.dir)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config plugins.dir must be a non-empty string when present.',
      ),
    );

    return {
      dir: DEFAULT_PLUGIN_DIRECTORY,
    };
  }

  return {
    dir: plugins_value.dir,
  };
}

/**
 * @param {unknown} queue_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   ready_ref_prefix: string,
 *   target_branch: string,
 *   upstream_remote: string,
 *   validation_flow: string | null,
 * }}
 */
/* eslint-disable-next-line max-lines-per-function */
function resolveQueueConfig(queue_value, pravaha_config_path, diagnostics) {
  /** @type {{
   *   base_ref: string,
   *   candidate_ref: string,
   *   dir: string,
   *   ready_ref_prefix: string,
   *   target_branch: string,
   *   upstream_remote: string,
   *   validation_flow: string | null,
   * }}
   */
  const queue_config = {
    base_ref: DEFAULT_QUEUE_BASE_REF,
    candidate_ref: DEFAULT_QUEUE_CANDIDATE_REF,
    dir: DEFAULT_QUEUE_DIRECTORY,
    ready_ref_prefix: DEFAULT_QUEUE_READY_REF_PREFIX,
    target_branch: DEFAULT_QUEUE_TARGET_BRANCH,
    upstream_remote: DEFAULT_QUEUE_UPSTREAM_REMOTE,
    validation_flow: null,
  };

  if (queue_value === undefined) {
    return queue_config;
  }

  if (!isPlainObject(queue_value)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config queue must be an object when present.',
      ),
    );

    return queue_config;
  }

  queue_config.dir = readOptionalStringConfig(
    queue_value.dir,
    queue_config.dir,
    pravaha_config_path,
    'Pravaha config queue.dir must be a non-empty string when present.',
    diagnostics,
  );
  queue_config.upstream_remote = readOptionalStringConfig(
    queue_value.upstream_remote,
    queue_config.upstream_remote,
    pravaha_config_path,
    'Pravaha config queue.upstream_remote must be a non-empty string when present.',
    diagnostics,
  );
  queue_config.target_branch = readOptionalStringConfig(
    queue_value.target_branch,
    queue_config.target_branch,
    pravaha_config_path,
    'Pravaha config queue.target_branch must be a non-empty string when present.',
    diagnostics,
  );
  queue_config.ready_ref_prefix = readOptionalStringConfig(
    queue_value.ready_ref_prefix,
    queue_config.ready_ref_prefix,
    pravaha_config_path,
    'Pravaha config queue.ready_ref_prefix must be a non-empty string when present.',
    diagnostics,
  );
  queue_config.candidate_ref = readOptionalStringConfig(
    queue_value.candidate_ref,
    queue_config.candidate_ref,
    pravaha_config_path,
    'Pravaha config queue.candidate_ref must be a non-empty string when present.',
    diagnostics,
  );
  queue_config.base_ref = readOptionalStringConfig(
    queue_value.base_ref,
    queue_config.base_ref,
    pravaha_config_path,
    'Pravaha config queue.base_ref must be a non-empty string when present.',
    diagnostics,
  );

  if (
    queue_value.validation_flow === undefined ||
    queue_value.validation_flow === null
  ) {
    return queue_config;
  }

  if (!isNonEmptyString(queue_value.validation_flow)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config queue.validation_flow must be a non-empty string or null when present.',
      ),
    );

    return queue_config;
  }

  queue_config.validation_flow = queue_value.validation_flow;

  return queue_config;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {string} pravaha_config_path
 * @param {string} error_message
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {string}
 */
function readOptionalStringConfig(
  value,
  fallback,
  pravaha_config_path,
  error_message,
  diagnostics,
) {
  if (value === undefined) {
    return fallback;
  }

  if (!isNonEmptyString(value)) {
    diagnostics.push(createDiagnostic(pravaha_config_path, error_message));

    return fallback;
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}
