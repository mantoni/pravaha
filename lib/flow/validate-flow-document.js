/* eslint-disable complexity, max-depth, max-lines, max-lines-per-function */
/** @import { PatramModel, ValidationDiagnostic } from '../shared/types/validation.types.ts' */

import { dirname } from 'node:path';

import { collectJavaScriptFlowDiagnostics } from './javascript-flow-module.js';
import { loadFlowDefinition } from './load-flow-definition.js';
import {
  validateSelectQueryText,
  validateExecutableQueryText,
} from './query.js';
import { loadStepPlugin } from '../plugins/plugin-loader.js';
import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';
import { parsePluginWithValue } from '../plugins/plugin-contract.js';

export { validateFlowDocument };

/**
 * @param {string} flow_document_text
 * @param {string} flow_file_path
 * @param {PatramModel | null} patram_model
 * @param {{
 *   repo_directory?: string,
 * }} [options]
 * @returns {Promise<ValidationDiagnostic[]>}
 */
async function validateFlowDocument(
  flow_document_text,
  flow_file_path,
  patram_model,
  options = {},
) {
  const load_result = await loadFlowDefinition(
    options.repo_directory ?? dirname(flow_file_path),
    flow_file_path,
    flow_document_text,
  );

  if (load_result.flow_definition === null) {
    return load_result.diagnostics;
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  if (load_result.surface === 'javascript-module') {
    diagnostics.push(
      ...collectJavaScriptFlowDiagnostics(
        load_result.flow_definition,
        flow_file_path,
      ),
    );
    diagnostics.push(
      ...collectWorkspaceDiagnostics(
        load_result.flow_definition.workspace,
        flow_file_path,
        'flow.workspace',
      ),
    );
  } else {
    diagnostics.push(
      ...collectStateMachineFlowDiagnostics(
        load_result.flow_definition,
        flow_file_path,
      ),
    );
    diagnostics.push(
      ...(await collectPluginDiagnostics(
        load_result.flow_definition,
        flow_file_path,
        options.repo_directory ?? dirname(flow_file_path),
      )),
    );
  }

  const trigger_validation = collectFlowTriggerDiagnostics(
    load_result.flow_definition,
    flow_file_path,
    patram_model,
  );

  diagnostics.push(...trigger_validation.diagnostics);

  if (patram_model === null) {
    return diagnostics;
  }

  validateFlowNode(
    load_result.flow_definition,
    flow_file_path,
    'flow',
    patram_model,
    diagnostics,
    trigger_validation.binding_names,
  );

  return diagnostics;
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {PatramModel} patram_model
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {string[]} executable_binding_names
 * @param {string} [node_key]
 */
function validateFlowNode(
  flow_node,
  flow_file_path,
  node_path,
  patram_model,
  diagnostics,
  executable_binding_names,
  node_key,
) {
  diagnostics.push(
    ...collectNodeDiagnostics(
      flow_node,
      flow_file_path,
      node_path,
      patram_model,
      executable_binding_names,
      node_key,
    ),
  );
  traverseChildNodes(
    flow_node,
    flow_file_path,
    node_path,
    patram_model,
    diagnostics,
    executable_binding_names,
  );
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {PatramModel} patram_model
 * @param {string[]} executable_binding_names
 * @param {string} [node_key]
 * @returns {ValidationDiagnostic[]}
 */
function collectNodeDiagnostics(
  flow_node,
  flow_file_path,
  node_path,
  patram_model,
  executable_binding_names,
  node_key,
) {
  if (node_path === 'flow.on') {
    return [];
  }

  if (node_path.startsWith('flow.on.') && node_key !== 'where') {
    return [];
  }

  if (/^flow\.jobs\.[^.]+\.next\[\d+\]\.if$/u.test(node_path)) {
    return [];
  }

  if (node_key === 'if') {
    if (typeof flow_node === 'string') {
      return validateExecutableQueryText(
        flow_node,
        flow_file_path,
        node_path,
        executable_binding_names,
      );
    }
  }

  return [];
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @param {string} repo_directory
 * @returns {Promise<ValidationDiagnostic[]>}
 */
async function collectPluginDiagnostics(
  flow_definition,
  flow_file_path,
  repo_directory,
) {
  if (!isPlainObject(flow_definition.jobs)) {
    return [];
  }

  /** @type {Map<string, Awaited<ReturnType<typeof loadStepPlugin>>['plugin']>} */
  const step_plugins = new Map();
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const [job_name, job_definition] of Object.entries(
    flow_definition.jobs,
  )) {
    if (!isPlainObject(job_definition)) {
      continue;
    }

    if (typeof job_definition.uses === 'string') {
      await loadJobPlugin(
        repo_directory,
        flow_file_path,
        diagnostics,
        step_plugins,
        job_definition.uses,
        `flow.jobs.${job_name}.uses`,
      );
    }
  }

  for (const [job_name, job_definition] of Object.entries(
    flow_definition.jobs,
  )) {
    if (!isPlainObject(job_definition)) {
      continue;
    }

    if (typeof job_definition.uses === 'string') {
      const plugin_definition = step_plugins.get(job_definition.uses);

      if (plugin_definition !== undefined) {
        try {
          parsePluginWithValue(
            plugin_definition,
            job_definition.uses,
            job_definition.with,
          );
        } catch (error) {
          const base_message = readErrorMessage(error);

          diagnostics.push(
            createDiagnostic(
              flow_file_path,
              base_message.startsWith('Did not expect with')
                ? `${base_message} at flow.jobs.${job_name}.with.`
                : `Invalid plugin with value at flow.jobs.${job_name}.with: ${base_message}`,
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

/**
 * @param {string} repo_directory
 * @param {string} flow_file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {Map<
 *   string,
 *   {
 *     run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *     with?: import('zod').ZodType,
 *   }
 * >} step_plugins
 * @param {string} uses_value
 * @param {string} node_path
 * @returns {Promise<void>}
 */
async function loadJobPlugin(
  repo_directory,
  flow_file_path,
  diagnostics,
  step_plugins,
  uses_value,
  node_path,
) {
  if (step_plugins.has(uses_value)) {
    return;
  }

  try {
    const plugin_result = await loadStepPlugin(repo_directory, uses_value);

    step_plugins.set(uses_value, plugin_result.plugin);
  } catch (error) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        `${readErrorMessage(error)} at ${node_path}.`,
      ),
    );
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @returns {ValidationDiagnostic[]}
 */
function collectStateMachineFlowDiagnostics(flow_definition, flow_file_path) {
  if (!isPlainObject(flow_definition.jobs)) {
    return [];
  }

  const job_entries = Object.entries(flow_definition.jobs);
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  if (job_entries.length === 0) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.jobs to declare at least one state-machine job.',
      ),
    );

    return diagnostics;
  }

  if (!Object.hasOwn(flow_definition, 'workspace')) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Legacy step-based flows are no longer supported. Add flow.workspace and rewrite jobs as state-machine nodes with uses/end plus next.',
      ),
    );
  }

  diagnostics.push(
    ...collectWorkspaceDiagnostics(
      flow_definition.workspace,
      flow_file_path,
      'flow.workspace',
    ),
  );

  const known_job_names = new Set(job_entries.map(([job_name]) => job_name));

  for (const [job_name, job_definition] of job_entries) {
    diagnostics.push(
      ...collectStateMachineJobDiagnostics(
        job_name,
        job_definition,
        known_job_names,
        flow_file_path,
      ),
    );
  }

  return diagnostics;
}

/**
 * @param {unknown} workspace_definition
 * @param {string} flow_file_path
 * @param {string} node_path
 * @returns {ValidationDiagnostic[]}
 */
function collectWorkspaceDiagnostics(
  workspace_definition,
  flow_file_path,
  node_path,
) {
  if (!isPlainObject(workspace_definition)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to be an object for state-machine flows.`,
      ),
    ];
  }

  if (
    typeof workspace_definition.id !== 'string' ||
    workspace_definition.id.trim() === ''
  ) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.id to be a non-empty string.`,
      ),
    ];
  }

  if (Object.keys(workspace_definition).some((key) => key !== 'id')) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to declare only id. Move lifecycle, placement, and checkout semantics into pravaha.json workspaces.`,
      ),
    ];
  }

  return [];
}

/**
 * @param {string} job_name
 * @param {unknown} job_definition
 * @param {Set<string>} known_job_names
 * @param {string} flow_file_path
 * @returns {ValidationDiagnostic[]}
 */
function collectStateMachineJobDiagnostics(
  job_name,
  job_definition,
  known_job_names,
  flow_file_path,
) {
  if (!isStateMachineJobDefinition(job_definition)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected flow.jobs.${job_name} to define a supported state-machine job.`,
      ),
    ];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];
  const job_path = `flow.jobs.${job_name}`;
  const terminal_job = Object.hasOwn(job_definition, 'end');

  if (terminal_job) {
    if (
      typeof job_definition.end !== 'string' ||
      job_definition.end.trim() === ''
    ) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${job_path}.end to be a non-empty string.`,
        ),
      );
    }

    for (const forbidden_field of ['limits', 'next', 'uses', 'with']) {
      if (Object.hasOwn(job_definition, forbidden_field)) {
        diagnostics.push(
          createDiagnostic(
            flow_file_path,
            `Did not expect ${job_path}.${forbidden_field} on a terminal end job.`,
          ),
        );
      }
    }

    diagnostics.push(
      ...collectUnexpectedStateMachineJobFieldDiagnostics(
        job_definition,
        new Set(['end', 'limits', 'next', 'uses', 'with']),
        flow_file_path,
        job_path,
        'terminal end job',
      ),
    );

    return diagnostics;
  }

  if (
    typeof job_definition.uses !== 'string' ||
    job_definition.uses.trim() === ''
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        `Expected ${job_path}.uses to be a non-empty string.`,
      ),
    );
  }

  diagnostics.push(
    ...collectNextDiagnostics(
      job_definition.next,
      known_job_names,
      flow_file_path,
      `${job_path}.next`,
    ),
  );

  if (Object.hasOwn(job_definition, 'limits')) {
    diagnostics.push(
      ...collectLimitsDiagnostics(
        job_definition.limits,
        flow_file_path,
        `${job_path}.limits`,
      ),
    );
  }

  for (const forbidden_field of [
    'needs',
    'relate',
    'steps',
    'transition',
    'worktree',
  ]) {
    if (Object.hasOwn(job_definition, forbidden_field)) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Legacy field ${job_path}.${forbidden_field} is no longer supported. Rewrite this job as a single uses/end node with next branching.`,
        ),
      );
    }
  }

  diagnostics.push(
    ...collectUnexpectedStateMachineJobFieldDiagnostics(
      job_definition,
      new Set([
        'limits',
        'needs',
        'next',
        'relate',
        'select',
        'steps',
        'transition',
        'uses',
        'with',
        'worktree',
      ]),
      flow_file_path,
      job_path,
      'state-machine action job',
    ),
  );

  return diagnostics;
}

/**
 * @param {Record<string, unknown>} job_definition
 * @param {Set<string>} allowed_field_names
 * @param {string} flow_file_path
 * @param {string} job_path
 * @param {string} job_kind
 * @returns {ValidationDiagnostic[]}
 */
function collectUnexpectedStateMachineJobFieldDiagnostics(
  job_definition,
  allowed_field_names,
  flow_file_path,
  job_path,
  job_kind,
) {
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const field_name of Object.keys(job_definition)) {
    if (allowed_field_names.has(field_name)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        `Did not expect ${job_path}.${field_name} on a ${job_kind}.`,
      ),
    );
  }

  return diagnostics;
}

/**
 * @param {unknown} next_definition
 * @param {Set<string>} known_job_names
 * @param {string} flow_file_path
 * @param {string} node_path
 * @returns {ValidationDiagnostic[]}
 */
function collectNextDiagnostics(
  next_definition,
  known_job_names,
  flow_file_path,
  node_path,
) {
  if (typeof next_definition === 'string') {
    return known_job_names.has(next_definition)
      ? []
      : [
          createDiagnostic(
            flow_file_path,
            `Unknown next target "${next_definition}" at ${node_path}.`,
          ),
        ];
  }

  if (!Array.isArray(next_definition) || next_definition.length === 0) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to be a non-empty string target or a non-empty branch list.`,
      ),
    ];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];
  let unconditional_branch_seen = false;

  next_definition.forEach((branch_definition, branch_index) => {
    const branch_path = `${node_path}[${branch_index}]`;

    if (!isPlainObject(branch_definition)) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${branch_path} to be an object.`,
        ),
      );
      return;
    }

    if (
      typeof branch_definition.goto !== 'string' ||
      branch_definition.goto.trim() === ''
    ) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${branch_path}.goto to be a non-empty string.`,
        ),
      );
    } else if (!known_job_names.has(branch_definition.goto)) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Unknown next target "${branch_definition.goto}" at ${branch_path}.goto.`,
        ),
      );
    }

    if (Object.hasOwn(branch_definition, 'if')) {
      if (
        typeof branch_definition.if !== 'string' ||
        branch_definition.if.trim() === ''
      ) {
        diagnostics.push(
          createDiagnostic(
            flow_file_path,
            `Expected ${branch_path}.if to be a non-empty string when present.`,
          ),
        );
      }
      return;
    }

    if (branch_index !== next_definition.length - 1) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Only the final ${node_path} branch may omit if.`,
        ),
      );
    }

    if (unconditional_branch_seen) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${node_path} to define at most one unconditional fallback branch.`,
        ),
      );
    }

    unconditional_branch_seen = true;
  });

  return diagnostics;
}

/**
 * @param {unknown} limits_definition
 * @param {string} flow_file_path
 * @param {string} node_path
 * @returns {ValidationDiagnostic[]}
 */
function collectLimitsDiagnostics(
  limits_definition,
  flow_file_path,
  node_path,
) {
  if (!isPlainObject(limits_definition)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to be an object.`,
      ),
    ];
  }

  if (!Object.hasOwn(limits_definition, 'max-visits')) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.max-visits to be defined.`,
      ),
    ];
  }

  if (
    typeof limits_definition['max-visits'] !== 'number' ||
    !Number.isInteger(limits_definition['max-visits']) ||
    limits_definition['max-visits'] < 1
  ) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.max-visits to be a positive integer.`,
      ),
    ];
  }

  return [];
}

/**
 * @param {unknown} job_definition
 * @returns {job_definition is Record<string, unknown>}
 */
function isStateMachineJobDefinition(job_definition) {
  return (
    isPlainObject(job_definition) &&
    (Object.hasOwn(job_definition, 'end') ||
      Object.hasOwn(job_definition, 'limits') ||
      Object.hasOwn(job_definition, 'next') ||
      Object.hasOwn(job_definition, 'uses'))
  );
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {PatramModel} patram_model
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {string[]} executable_binding_names
 */
function traverseChildNodes(
  flow_node,
  flow_file_path,
  node_path,
  patram_model,
  diagnostics,
  executable_binding_names,
) {
  if (Array.isArray(flow_node)) {
    flow_node.forEach((child_node, index) => {
      validateFlowNode(
        child_node,
        flow_file_path,
        `${node_path}[${index}]`,
        patram_model,
        diagnostics,
        executable_binding_names,
      );
    });

    return;
  }

  if (!isPlainObject(flow_node)) {
    return;
  }

  for (const [child_key, child_node] of Object.entries(flow_node)) {
    validateFlowNode(
      child_node,
      flow_file_path,
      `${node_path}.${child_key}`,
      patram_model,
      diagnostics,
      executable_binding_names,
      child_key,
    );
  }
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @param {PatramModel | null} patram_model
 * @returns {{
 *   binding_names: string[],
 *   diagnostics: ValidationDiagnostic[],
 * }}
 */
function collectFlowTriggerDiagnostics(
  flow_definition,
  flow_file_path,
  patram_model,
) {
  const on_definition = flow_definition.on;
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  if (on_definition === undefined) {
    return {
      binding_names: [],
      diagnostics: [
        createDiagnostic(
          flow_file_path,
          'Expected flow.on.patram to be defined as a string.',
        ),
      ],
    };
  }

  if (!isPlainObject(on_definition)) {
    return {
      binding_names: [],
      diagnostics: [
        createDiagnostic(flow_file_path, 'Expected flow.on to be an object.'),
      ],
    };
  }

  const on_entries = Object.entries(on_definition);

  if (
    on_entries.length !== 1 ||
    Object.hasOwn(on_definition, 'patram') === false
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on to define only flow.on.patram.',
      ),
    );
  }

  if (typeof on_definition.patram !== 'string') {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on.patram to be a string.',
      ),
    );

    return {
      binding_names: [],
      diagnostics,
    };
  }

  if (patram_model !== null) {
    diagnostics.push(
      ...validateSelectQueryText(
        on_definition.patram,
        flow_file_path,
        'flow.on.patram',
        patram_model.class_names,
      ),
    );
  }

  const owner_class = readOptionalOwnerClass(on_definition.patram);

  return {
    binding_names: owner_class === '' ? [] : [owner_class],
    diagnostics,
  };
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function readOwnerClass(query_text) {
  const class_matches = query_text
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .matchAll(/\$class\s*(?:==|=)\s*([$\w-]+)|\$class\s+in\s+\[([^\]]+)\]/gu);
  /** @type {string[]} */
  const class_names = [];

  for (const match of class_matches) {
    if (typeof match[1] === 'string') {
      class_names.push(match[1]);
      continue;
    }

    if (typeof match[2] === 'string') {
      class_names.push(
        ...match[2]
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      );
    }
  }

  const unique_class_names = [...new Set(class_names)].filter(
    (class_name) => !class_name.startsWith('$'),
  );

  if (unique_class_names.length !== 1) {
    throw new Error('Expected exactly one owner class.');
  }

  return unique_class_names[0];
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function readOptionalOwnerClass(query_text) {
  try {
    return readOwnerClass(query_text);
  } catch {
    return '';
  }
}
