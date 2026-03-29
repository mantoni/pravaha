/* eslint-disable complexity, max-lines, max-lines-per-function */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeFlowQuery, resolveDurableQueryRole } from './query.js';
import { parseFlowDefinition } from './load-flow-definition.js';
import { collectFlowStepPlugins } from '../plugins/plugin-loader.js';
import { parsePluginWithValue } from '../plugins/plugin-contract.js';
import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

export { loadExecutableDispatchFlow, loadStateMachineFlow };

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   flow: Awaited<ReturnType<typeof loadStateMachineFlow>>,
 *   surface: 'state-machine',
 * }>}
 */
async function loadExecutableDispatchFlow(repo_directory, flow_path) {
  return {
    flow: await loadStateMachineFlow(repo_directory, flow_path),
    surface: 'state-machine',
  };
}

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   ordered_jobs: Array<
 *     | {
 *         job_name: string,
 *         kind: 'action',
 *         limits: { max_visits: number } | null,
 *         next_branches: Array<{
 *           condition_text: string | null,
 *           target_job_name: string,
 *         }>,
 *         uses_value: string,
 *         with_value: unknown,
 *       }
 *     | {
 *         end_state: string,
 *         job_name: string,
 *         kind: 'end',
 *       }
 *   >,
 *   start_job_name: string,
 *   trigger: {
 *     binding_name: string,
 *     query_text: string,
 *     role: string,
 *   },
 *   workspace: {
 *     materialize: {
 *       kind: 'worktree',
 *       mode: 'ephemeral' | 'pooled',
 *       ref: string,
 *     },
 *     source: {
 *       id: string,
 *       kind: 'repo',
 *     },
 *     type: 'git.workspace',
 *   },
 * }>}
 */
async function loadStateMachineFlow(repo_directory, flow_path) {
  const flow_definition = await readFlowDefinition(repo_directory, flow_path);
  const flow_step_plugins = await collectFlowStepPlugins(
    repo_directory,
    flow_definition,
  );

  if (!isPlainObject(flow_definition.jobs)) {
    throw new Error(`Expected ${flow_path} to define a jobs mapping.`);
  }

  const job_entries = Object.entries(flow_definition.jobs);

  if (job_entries.length === 0) {
    throw new Error(`Expected ${flow_path} to define at least one job.`);
  }

  const known_job_names = new Set(job_entries.map(([job_name]) => job_name));
  const ordered_jobs = job_entries.map(([job_name, job_definition]) =>
    interpretStateMachineJob(
      job_name,
      job_definition,
      flow_path,
      known_job_names,
      flow_step_plugins.step_plugins,
    ),
  );

  return {
    ordered_jobs,
    start_job_name: job_entries[0][0],
    trigger: interpretFlowTriggerDefinition(flow_definition.on, flow_path),
    workspace: interpretStateMachineWorkspace(
      flow_definition.workspace,
      flow_path,
    ),
  };
}

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readFlowDefinition(repo_directory, flow_path) {
  const flow_document_text = await readFile(
    join(repo_directory, flow_path),
    'utf8',
  );
  const parse_result = parseFlowDefinition(flow_document_text, flow_path);

  if (
    parse_result.diagnostics.length > 0 ||
    parse_result.flow_definition === null
  ) {
    throw new Error(formatDiagnostics(parse_result.diagnostics));
  }

  return parse_result.flow_definition;
}

/**
 * @param {string} job_name
 * @param {unknown} job_definition
 * @param {string} flow_path
 * @param {Set<string>} known_job_names
 * @param {Map<
 *   string,
 *   {
 *     plugin: {
 *       run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *       with?: import('zod').ZodType,
 *     },
 *     resolution: Record<string, string>,
 *   }
 * >} step_plugins
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'][number]}
 */
function interpretStateMachineJob(
  job_name,
  job_definition,
  flow_path,
  known_job_names,
  step_plugins,
) {
  if (!isPlainObject(job_definition)) {
    throw new Error(
      `Expected ${flow_path} to define one supported state-machine job object.`,
    );
  }

  if (Object.hasOwn(job_definition, 'end')) {
    if (
      typeof job_definition.end !== 'string' ||
      job_definition.end.trim() === ''
    ) {
      throw new Error(
        `Expected ${flow_path} end jobs to define a non-empty end state.`,
      );
    }

    return {
      end_state: job_definition.end,
      job_name,
      kind: 'end',
    };
  }

  if (
    typeof job_definition.uses !== 'string' ||
    job_definition.uses.trim() === ''
  ) {
    throw new Error(
      `Expected ${flow_path} action jobs to define a non-empty uses value.`,
    );
  }

  const plugin_result = step_plugins.get(job_definition.uses);

  if (plugin_result === undefined) {
    throw new Error(
      `Unsupported uses step "${job_definition.uses}" in ${flow_path}.`,
    );
  }

  return {
    job_name,
    kind: 'action',
    limits: interpretStateMachineLimits(job_definition.limits, flow_path),
    next_branches: interpretStateMachineNext(
      job_definition.next,
      flow_path,
      known_job_names,
    ),
    uses_value: job_definition.uses,
    with_value: interpretPluginWithValue(
      plugin_result.plugin,
      job_definition.uses,
      job_definition.with,
      flow_path,
    ),
  };
}

/**
 * @param {unknown} limits_definition
 * @param {string} flow_path
 * @returns {{ max_visits: number } | null}
 */
function interpretStateMachineLimits(limits_definition, flow_path) {
  if (limits_definition === undefined) {
    return null;
  }

  if (!isPlainObject(limits_definition)) {
    throw new Error(`Expected ${flow_path} limits to be an object.`);
  }

  if (
    typeof limits_definition['max-visits'] !== 'number' ||
    !Number.isInteger(limits_definition['max-visits']) ||
    limits_definition['max-visits'] < 1
  ) {
    throw new Error(
      `Expected ${flow_path} limits.max-visits to be a positive integer.`,
    );
  }

  return {
    max_visits: limits_definition['max-visits'],
  };
}

/**
 * @param {unknown} next_definition
 * @param {string} flow_path
 * @param {Set<string>} known_job_names
 * @returns {Array<{ condition_text: string | null, target_job_name: string }>}
 */
function interpretStateMachineNext(
  next_definition,
  flow_path,
  known_job_names,
) {
  if (typeof next_definition === 'string') {
    return [
      {
        condition_text: null,
        target_job_name: interpretStateMachineGoto(
          next_definition,
          flow_path,
          known_job_names,
        ),
      },
    ];
  }

  if (!Array.isArray(next_definition) || next_definition.length === 0) {
    throw new Error(
      `Expected ${flow_path} action jobs to define next as a non-empty string target or branch list.`,
    );
  }

  return next_definition.map((branch_definition, branch_index) => {
    if (!isPlainObject(branch_definition)) {
      throw new Error(`Expected ${flow_path} next branches to be objects.`);
    }

    if (
      !Object.hasOwn(branch_definition, 'if') &&
      branch_index !== next_definition.length - 1
    ) {
      throw new Error(
        `Expected only the final next branch in ${flow_path} to omit if.`,
      );
    }

    return {
      condition_text:
        typeof branch_definition.if === 'string' ? branch_definition.if : null,
      target_job_name: interpretStateMachineGoto(
        branch_definition.goto,
        flow_path,
        known_job_names,
      ),
    };
  });
}

/**
 * @param {unknown} goto_value
 * @param {string} flow_path
 * @param {Set<string>} known_job_names
 * @returns {string}
 */
function interpretStateMachineGoto(goto_value, flow_path, known_job_names) {
  if (typeof goto_value !== 'string' || goto_value.trim() === '') {
    throw new Error(
      `Expected ${flow_path} next.goto values to be non-empty strings.`,
    );
  }

  if (!known_job_names.has(goto_value)) {
    throw new Error(`Unknown next target "${goto_value}" in ${flow_path}.`);
  }

  return goto_value;
}

/**
 * @param {unknown} workspace_definition
 * @param {string} flow_path
 * @returns {{
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   source: {
 *     id: string,
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }}
 */
function interpretStateMachineWorkspace(workspace_definition, flow_path) {
  if (!isPlainObject(workspace_definition)) {
    throw new Error(
      `Expected ${flow_path} to define a supported flow-level workspace.`,
    );
  }

  if (workspace_definition.type !== 'git.workspace') {
    throw new Error(
      `Expected ${flow_path} workspace.type to be "git.workspace".`,
    );
  }

  if (!isPlainObject(workspace_definition.source)) {
    throw new Error(`Expected ${flow_path} workspace.source to be an object.`);
  }

  if (workspace_definition.source.kind !== 'repo') {
    throw new Error(
      `Expected ${flow_path} workspace.source.kind to be "repo".`,
    );
  }

  if (
    typeof workspace_definition.source.id !== 'string' ||
    workspace_definition.source.id.trim() === ''
  ) {
    throw new Error(
      `Expected ${flow_path} workspace.source.id to be a non-empty string.`,
    );
  }

  if (!isPlainObject(workspace_definition.materialize)) {
    throw new Error(
      `Expected ${flow_path} workspace.materialize to be an object.`,
    );
  }

  if (workspace_definition.materialize.kind !== 'worktree') {
    throw new Error(
      `Expected ${flow_path} workspace.materialize.kind to be "worktree".`,
    );
  }

  if (
    workspace_definition.materialize.mode !== 'ephemeral' &&
    workspace_definition.materialize.mode !== 'pooled'
  ) {
    throw new Error(
      `Expected ${flow_path} workspace.materialize.mode to be "ephemeral" or "pooled".`,
    );
  }

  if (
    typeof workspace_definition.materialize.ref !== 'string' ||
    workspace_definition.materialize.ref.trim() === ''
  ) {
    throw new Error(
      `Expected ${flow_path} workspace.materialize.ref to be a non-empty string.`,
    );
  }

  return {
    materialize: {
      kind: 'worktree',
      mode: workspace_definition.materialize.mode,
      ref: workspace_definition.materialize.ref,
    },
    source: {
      id: workspace_definition.source.id,
      kind: 'repo',
    },
    type: 'git.workspace',
  };
}

/**
 * @param {unknown} on_definition
 * @param {string} flow_path
 * @returns {{ binding_name: string, query_text: string, role: string }}
 */
function interpretFlowTriggerDefinition(on_definition, flow_path) {
  if (!isPlainObject(on_definition)) {
    throw new Error(
      `Expected ${flow_path} to define exactly one root trigger binding.`,
    );
  }

  const on_entries = Object.entries(on_definition);

  if (on_entries.length !== 1) {
    throw new Error(
      `Expected ${flow_path} to define exactly one root trigger binding.`,
    );
  }

  const [[binding_name, binding_definition]] = on_entries;

  if (binding_name === 'document') {
    throw new Error(
      `Reserved trigger binding name "${binding_name}" is not supported in ${flow_path}.`,
    );
  }

  if (!isPlainObject(binding_definition)) {
    throw new Error(
      `Expected on.${binding_name} in ${flow_path} to be an object.`,
    );
  }

  if (typeof binding_definition.where !== 'string') {
    throw new Error(
      `Expected on.${binding_name}.where in ${flow_path} to be a string.`,
    );
  }

  return {
    binding_name,
    query_text: normalizeFlowQuery(binding_definition.where),
    role: resolveDurableQueryRole(binding_definition.where),
  };
}

/**
 * @param {{
 *   run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *   with?: import('zod').ZodType,
 * }} plugin_definition
 * @param {string} uses_value
 * @param {unknown} with_value
 * @param {string} flow_path
 * @returns {unknown}
 */
function interpretPluginWithValue(
  plugin_definition,
  uses_value,
  with_value,
  flow_path,
) {
  try {
    return parsePluginWithValue(plugin_definition, uses_value, with_value);
  } catch (error) {
    throw new Error(`${readErrorMessage(error)} in ${flow_path}.`, {
      cause: error,
    });
  }
}

/**
 * @param {Array<{ file_path: string, message: string }>} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
    .join('\n');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
