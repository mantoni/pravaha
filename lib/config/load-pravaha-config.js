/* eslint-disable max-lines */
/** @import { ValidationDiagnostic } from '../shared/types/validation.types.ts' */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';
import { assertValidConfig } from './config-contract.js';

const PRAVAHA_CONFIG_FILENAME = 'pravaha.config.js';
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
 *   module_diagnostics: ValidationDiagnostic[],
 *   normalization_diagnostics: ValidationDiagnostic[],
 * }>}
 */
async function loadPravahaConfig(repo_directory) {
  const pravaha_config_path = join(repo_directory, PRAVAHA_CONFIG_FILENAME);
  const module_load_result = await loadPravahaConfigModule(pravaha_config_path);
  /** @type {ValidationDiagnostic[]} */
  const normalization_diagnostics = [];
  const config = normalizePravahaConfig(
    module_load_result.value,
    pravaha_config_path,
    normalization_diagnostics,
  );
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [
    ...module_load_result.diagnostics,
    ...normalization_diagnostics,
  ];

  return {
    config,
    diagnostics,
    file_path: pravaha_config_path,
    module_diagnostics: module_load_result.diagnostics,
    normalization_diagnostics,
  };
}

/**
 * @param {string} pravaha_config_path
 * @returns {Promise<{
 *   diagnostics: ValidationDiagnostic[],
 *   value: unknown,
 * }>}
 */
async function loadPravahaConfigModule(pravaha_config_path) {
  /** @type {{ default?: unknown }} */
  let module_namespace;

  try {
    const config_url = pathToFileURL(pravaha_config_path);

    config_url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
    module_namespace = await importConfigModule(config_url.href);
  } catch (error) {
    return {
      diagnostics: [
        createDiagnostic(
          pravaha_config_path,
          `Cannot load Pravaha config module: ${getErrorMessage(error)}`,
        ),
      ],
      value: null,
    };
  }

  try {
    return {
      diagnostics: [],
      value: assertValidConfig(module_namespace.default, pravaha_config_path),
    };
  } catch (error) {
    return {
      diagnostics: [
        createDiagnostic(pravaha_config_path, getErrorMessage(error)),
      ],
      value: null,
    };
  }
}

/**
 * @param {string} module_url
 * @returns {Promise<{ default?: unknown }>}
 */
async function importConfigModule(module_url) {
  // Dynamic import returns `any` in JS; narrow it immediately before use.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const imported_module = await import(module_url);
  /** @type {unknown} */
  const unknown_module = imported_module;

  return /** @type {{ default?: unknown }} */ (unknown_module);
}

/**
 * @param {unknown} pravaha_config_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @internal
 * @returns {{
 *   flow_config: {
 *     matches: string[],
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
 *   workspace_config: Record<string,
 *     | {
 *         base_path: string,
 *         mode: 'ephemeral',
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *     | {
 *         mode: 'pooled',
 *         paths: string[],
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *   >,
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
  resolvePluginConfig(
    pravaha_config_object.plugins,
    pravaha_config_path,
    diagnostics,
  );

  return {
    flow_config: resolveFlowConfig(
      pravaha_config_object.flows,
      pravaha_config_path,
      diagnostics,
    ),
    queue_config: resolveQueueConfig(
      pravaha_config_object.queue,
      pravaha_config_path,
      diagnostics,
    ),
    workspace_config: resolveWorkspaceConfig(
      pravaha_config_object.workspaces,
      pravaha_config_path,
      diagnostics,
    ),
  };
}

/**
 * @param {unknown} flows_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{ matches: string[] }}
 */
function resolveFlowConfig(flows_value, pravaha_config_path, diagnostics) {
  /** @type {{ matches: string[] }} */
  const flow_config = {
    matches: [],
  };

  if (flows_value === undefined) {
    return flow_config;
  }

  if (!Array.isArray(flows_value)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config flows must be an array of non-empty .js or .mjs paths/globs when present.',
      ),
    );

    return flow_config;
  }

  if (!flows_value.every(isJavaScriptFlowReference)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config flows must be an array of non-empty .js or .mjs paths/globs when present.',
      ),
    );

    return flow_config;
  }

  flow_config.matches = [...flows_value];

  return flow_config;
}

/**
 * @param {unknown} plugins_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {void}
 */
function resolvePluginConfig(plugins_value, pravaha_config_path, diagnostics) {
  if (plugins_value === undefined) {
    return;
  }

  diagnostics.push(
    createDiagnostic(
      pravaha_config_path,
      'Pravaha config plugins has been removed.',
    ),
  );
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

  if (!isJavaScriptFlowReference(queue_value.validation_flow)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config queue.validation_flow must be a non-empty .js or .mjs path when present.',
      ),
    );

    return queue_config;
  }

  queue_config.validation_flow = queue_value.validation_flow;

  return queue_config;
}

/**
 * @param {unknown} workspaces_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Record<string,
 *   | {
 *       base_path: string,
 *       mode: 'ephemeral',
 *       ref: string,
 *       source: {
 *         kind: 'repo',
 *       },
 *     }
 *   | {
 *       mode: 'pooled',
 *       paths: string[],
 *       ref: string,
 *       source: {
 *         kind: 'repo',
 *       },
 *     }
 * >}
 */
// eslint-disable-next-line max-lines-per-function, complexity
function resolveWorkspaceConfig(
  workspaces_value,
  pravaha_config_path,
  diagnostics,
) {
  /** @type {Record<string,
   *   | {
   *       base_path: string,
   *       mode: 'ephemeral',
   *       ref: string,
   *       source: {
   *         kind: 'repo',
   *       },
   *     }
   *   | {
   *       mode: 'pooled',
   *       paths: string[],
   *       ref: string,
   *       source: {
   *         kind: 'repo',
   *       },
   *     }
   * >} */
  const workspace_config = {};

  if (workspaces_value === undefined) {
    return workspace_config;
  }

  if (!isPlainObject(workspaces_value)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config workspaces must be an object when present.',
      ),
    );

    return workspace_config;
  }

  for (const [workspace_id, workspace_definition] of Object.entries(
    workspaces_value,
  )) {
    if (!isNonEmptyString(workspace_id)) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          'Pravaha config workspaces must use non-empty ids.',
        ),
      );
      continue;
    }

    if (!isPlainObject(workspace_definition)) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id} must be an object.`,
        ),
      );
      continue;
    }

    if (
      workspace_definition.mode !== 'pooled' &&
      workspace_definition.mode !== 'ephemeral'
    ) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id}.mode must be "pooled" or "ephemeral".`,
        ),
      );
      continue;
    }

    if (!isPlainObject(workspace_definition.source)) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id}.source must be an object.`,
        ),
      );
      continue;
    }

    if (workspace_definition.source.kind !== 'repo') {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id}.source.kind must be "repo".`,
        ),
      );
      continue;
    }

    if (!isNonEmptyString(workspace_definition.ref)) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id}.ref must be a non-empty string.`,
        ),
      );
      continue;
    }

    if (
      workspace_definition.mode === 'pooled' &&
      workspace_definition.base_path !== undefined
    ) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id} must not define base_path for pooled mode.`,
        ),
      );
      continue;
    }

    if (
      workspace_definition.mode === 'ephemeral' &&
      workspace_definition.paths !== undefined
    ) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id} must not define paths for ephemeral mode.`,
        ),
      );
      continue;
    }

    if (workspace_definition.mode === 'pooled') {
      if (!hasUniqueNonEmptyStringArray(workspace_definition.paths)) {
        diagnostics.push(
          createDiagnostic(
            pravaha_config_path,
            `Pravaha config workspaces.${workspace_id}.paths must be an array of unique non-empty strings.`,
          ),
        );
        continue;
      }

      workspace_config[workspace_id] = {
        mode: 'pooled',
        paths: [...workspace_definition.paths],
        ref: workspace_definition.ref,
        source: {
          kind: 'repo',
        },
      };
      continue;
    }

    if (!isNonEmptyString(workspace_definition.base_path)) {
      diagnostics.push(
        createDiagnostic(
          pravaha_config_path,
          `Pravaha config workspaces.${workspace_id}.base_path must be a non-empty string.`,
        ),
      );
      continue;
    }

    workspace_config[workspace_id] = {
      base_path: workspace_definition.base_path,
      mode: 'ephemeral',
      ref: workspace_definition.ref,
      source: {
        kind: 'repo',
      },
    };
  }

  return workspace_config;
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
function isJavaScriptFlowReference(value) {
  return (
    isNonEmptyString(value) && (value.endsWith('.js') || value.endsWith('.mjs'))
  );
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function hasUniqueNonEmptyStringArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const normalized_entries = value.map((entry) =>
    typeof entry === 'string' ? entry.trim() : '',
  );

  if (normalized_entries.some((entry) => entry === '')) {
    return false;
  }

  return new Set(normalized_entries).size === normalized_entries.length;
}
