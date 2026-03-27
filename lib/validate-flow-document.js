/* eslint-disable complexity, max-depth, max-lines, max-lines-per-function */
/** @import { SemanticModel, ValidationDiagnostic } from './validation.types.ts' */

import { dirname } from 'node:path';

import { parseFlowDefinition } from './load-flow-definition.js';
import {
  normalizeFlowQuery,
  usesQuerySyntax,
  validateExecutableQueryText,
  validateSelectQueryText,
} from './flow-query.js';
import { loadStepPlugin } from './plugin-loader.js';
import { createDiagnostic, isPlainObject } from './validation-helpers.js';
import { parsePluginWithValue } from './plugin-contract.js';
import {
  validateRelateReference,
  validateSemanticRoleReference,
  validateSemanticStateReference,
} from './validate-semantic-reference.js';

export { validateFlowDocument };

/**
 * @param {string} flow_document_text
 * @param {string} flow_file_path
 * @param {SemanticModel | null} semantic_model
 * @param {{
 *   repo_directory?: string,
 * }} [options]
 * @returns {Promise<ValidationDiagnostic[]>}
 */
async function validateFlowDocument(
  flow_document_text,
  flow_file_path,
  semantic_model,
  options = {},
) {
  const parse_result = parseFlowDefinition(flow_document_text, flow_file_path);

  if (parse_result.flow_definition === null) {
    return parse_result.diagnostics;
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  diagnostics.push(
    ...collectJobWorktreeDiagnostics(
      parse_result.flow_definition,
      flow_file_path,
    ),
  );
  diagnostics.push(
    ...collectJobNeedsDiagnostics(parse_result.flow_definition, flow_file_path),
  );
  diagnostics.push(
    ...collectStateMachineFlowDiagnostics(
      parse_result.flow_definition,
      flow_file_path,
    ),
  );
  diagnostics.push(
    ...(await collectPluginDiagnostics(
      parse_result.flow_definition,
      flow_file_path,
      options.repo_directory ?? dirname(flow_file_path),
    )),
  );

  const trigger_validation = collectFlowTriggerDiagnostics(
    parse_result.flow_definition,
    flow_file_path,
    semantic_model,
  );

  diagnostics.push(...trigger_validation.diagnostics);

  if (semantic_model === null) {
    return diagnostics;
  }

  validateFlowNode(
    parse_result.flow_definition,
    flow_file_path,
    'flow',
    semantic_model,
    diagnostics,
    trigger_validation.binding_names,
  );

  return diagnostics;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @returns {ValidationDiagnostic[]}
 */
function collectJobWorktreeDiagnostics(flow_definition, flow_file_path) {
  if (!isPlainObject(flow_definition.jobs)) {
    return [];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const [job_name, job_definition] of Object.entries(
    flow_definition.jobs,
  )) {
    if (!isPlainObject(job_definition)) {
      continue;
    }

    const job_path = `flow.jobs.${job_name}`;

    if (Object.hasOwn(job_definition, 'worktree')) {
      diagnostics.push(
        ...collectWorktreePolicyDiagnostics(
          job_definition.worktree,
          flow_file_path,
          `${job_path}.worktree`,
        ),
      );
    }

    if (!Array.isArray(job_definition.steps)) {
      continue;
    }

    job_definition.steps.forEach((step, index) => {
      if (!isPlainObject(step) || !Object.hasOwn(step, 'worktree')) {
        return;
      }

      diagnostics.push({
        file_path: flow_file_path,
        message: `Step-level worktree overrides are not allowed at ${job_path}.steps[${index}].worktree.`,
      });
    });
  }

  return diagnostics;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @returns {ValidationDiagnostic[]}
 */
function collectJobNeedsDiagnostics(flow_definition, flow_file_path) {
  if (!isPlainObject(flow_definition.jobs)) {
    return [];
  }

  const job_entries = Object.entries(flow_definition.jobs);
  const known_job_names = new Set(job_entries.map(([job_name]) => job_name));
  /** @type {Set<string>} */
  const earlier_job_names = new Set();
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const [job_name, job_definition] of job_entries) {
    if (!isPlainObject(job_definition) || job_definition.needs === undefined) {
      earlier_job_names.add(job_name);
      continue;
    }

    if (!Array.isArray(job_definition.needs)) {
      diagnostics.push({
        file_path: flow_file_path,
        message: `Expected flow.jobs.${job_name}.needs to be an array of job names.`,
      });
      earlier_job_names.add(job_name);
      continue;
    }

    job_definition.needs.forEach((need_name, index) => {
      if (typeof need_name !== 'string' || need_name.trim() === '') {
        diagnostics.push({
          file_path: flow_file_path,
          message: `Expected flow.jobs.${job_name}.needs[${index}] to be a non-empty string.`,
        });
        return;
      }

      if (!known_job_names.has(need_name)) {
        diagnostics.push({
          file_path: flow_file_path,
          message: `Unknown job "${need_name}" at flow.jobs.${job_name}.needs[${index}].`,
        });
        return;
      }

      if (!earlier_job_names.has(need_name)) {
        diagnostics.push({
          file_path: flow_file_path,
          message: `Expected flow.jobs.${job_name}.needs[${index}] to reference an earlier declared job.`,
        });
      }
    });

    earlier_job_names.add(job_name);
  }

  return diagnostics;
}

/**
 * @param {unknown} worktree_policy
 * @param {string} flow_file_path
 * @param {string} node_path
 * @returns {ValidationDiagnostic[]}
 */
function collectWorktreePolicyDiagnostics(
  worktree_policy,
  flow_file_path,
  node_path,
) {
  if (!isPlainObject(worktree_policy)) {
    return [
      {
        file_path: flow_file_path,
        message: `Expected ${node_path} to be an object.`,
      },
    ];
  }

  if (
    worktree_policy.mode !== 'ephemeral' &&
    worktree_policy.mode !== 'named'
  ) {
    return [
      {
        file_path: flow_file_path,
        message: `Expected ${node_path}.mode to be "ephemeral" or "named".`,
      },
    ];
  }

  if (worktree_policy.mode === 'ephemeral') {
    if (Object.hasOwn(worktree_policy, 'slot')) {
      return [
        {
          file_path: flow_file_path,
          message: `Did not expect ${node_path}.slot when mode is "ephemeral".`,
        },
      ];
    }

    return [];
  }

  if (
    typeof worktree_policy.slot !== 'string' ||
    worktree_policy.slot.trim() === ''
  ) {
    return [
      {
        file_path: flow_file_path,
        message: `Expected ${node_path}.slot to be a non-empty string when mode is "named".`,
      },
    ];
  }

  return [];
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {SemanticModel} semantic_model
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {string[]} executable_binding_names
 * @param {string} [node_key]
 */
function validateFlowNode(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  diagnostics,
  executable_binding_names,
  node_key,
) {
  diagnostics.push(
    ...collectNodeDiagnostics(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model,
      executable_binding_names,
      node_key,
    ),
  );
  traverseChildNodes(
    flow_node,
    flow_file_path,
    node_path,
    semantic_model,
    diagnostics,
    executable_binding_names,
  );
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {SemanticModel} semantic_model
 * @param {string[]} executable_binding_names
 * @param {string} [node_key]
 * @returns {ValidationDiagnostic[]}
 */
function collectNodeDiagnostics(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  executable_binding_names,
  node_key,
) {
  if (node_path === 'flow.on') {
    return [];
  }

  if (node_path.startsWith('flow.on.') && node_key !== 'where') {
    return [];
  }

  if (/^flow\.jobs\.[^.]+\.select$/u.test(node_path)) {
    return [];
  }

  if (/^flow\.jobs\.[^.]+\.next\[\d+\]\.if$/u.test(node_path)) {
    return [];
  }

  if (node_key === 'select') {
    if (typeof flow_node === 'string') {
      return validateSelectQueryText(
        flow_node,
        flow_file_path,
        node_path,
        semantic_model.semantic_role_names,
      );
    }

    return validateSemanticRoleReference(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model.semantic_role_names,
    );
  }

  if (node_key === 'transition') {
    if (isPlainObject(flow_node) && Object.hasOwn(flow_node, 'status')) {
      return validateSemanticStateReference(
        flow_node.status,
        flow_file_path,
        `${node_path}.status`,
        semantic_model.semantic_state_names,
      );
    }

    return validateSemanticStateReference(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model.semantic_state_names,
    );
  }

  if (node_key === 'await') {
    if (typeof flow_node === 'string' && usesQuerySyntax(flow_node)) {
      return validateExecutableQueryText(
        flow_node,
        flow_file_path,
        node_path,
        executable_binding_names,
      );
    }
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

  if (node_key === 'relate') {
    return validateRelateReference(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model.semantic_role_names,
    );
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
  /** @type {Set<string>} */
  const emitted_signal_kinds = new Set();
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
        emitted_signal_kinds,
        job_definition.uses,
        `flow.jobs.${job_name}.uses`,
      );
    }

    if (!Array.isArray(job_definition.steps)) {
      continue;
    }

    for (const [
      step_index,
      step_definition,
    ] of job_definition.steps.entries()) {
      if (
        !isPlainObject(step_definition) ||
        typeof step_definition.uses !== 'string'
      ) {
        continue;
      }

      await loadJobPlugin(
        repo_directory,
        flow_file_path,
        diagnostics,
        step_plugins,
        emitted_signal_kinds,
        step_definition.uses,
        `flow.jobs.${job_name}.steps[${step_index}].uses`,
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

    if (!Array.isArray(job_definition.steps)) {
      continue;
    }

    for (const [
      step_index,
      step_definition,
    ] of job_definition.steps.entries()) {
      if (!isPlainObject(step_definition)) {
        continue;
      }

      const step_path = `flow.jobs.${job_name}.steps[${step_index}]`;

      if (typeof step_definition.uses === 'string') {
        const plugin_definition = step_plugins.get(step_definition.uses);

        if (plugin_definition !== undefined) {
          try {
            parsePluginWithValue(
              plugin_definition,
              step_definition.uses,
              step_definition.with,
            );
          } catch (error) {
            const base_message = readErrorMessage(error);

            diagnostics.push(
              createDiagnostic(
                flow_file_path,
                base_message.startsWith('Did not expect with')
                  ? `${base_message} at ${step_path}.with.`
                  : `Invalid plugin with value at ${step_path}.with: ${base_message}`,
              ),
            );
          }
        }
      }

      if (typeof step_definition.await !== 'string') {
        continue;
      }

      for (const signal_kind of collectAwaitSignalKinds(
        step_definition.await,
      )) {
        if (!emitted_signal_kinds.has(signal_kind)) {
          diagnostics.push(
            createDiagnostic(
              flow_file_path,
              `Unknown await signal kind "${signal_kind}" at ${step_path}.await.`,
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
 *     emits: Record<string, import('zod').ZodType>,
 *     run: (context: Record<string, unknown>) => Promise<void> | void,
 *     with?: import('zod').ZodType,
 *   }
 * >} step_plugins
 * @param {Set<string>} emitted_signal_kinds
 * @param {string} uses_value
 * @param {string} node_path
 * @returns {Promise<void>}
 */
async function loadJobPlugin(
  repo_directory,
  flow_file_path,
  diagnostics,
  step_plugins,
  emitted_signal_kinds,
  uses_value,
  node_path,
) {
  if (step_plugins.has(uses_value)) {
    return;
  }

  try {
    const plugin_result = await loadStepPlugin(repo_directory, uses_value);

    step_plugins.set(uses_value, plugin_result.plugin);

    for (const signal_kind of Object.keys(plugin_result.plugin.emits)) {
      emitted_signal_kinds.add(signal_kind);
    }
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
 * @param {string} await_value
 * @returns {string[]}
 */
function collectAwaitSignalKinds(await_value) {
  const normalized_await = normalizeFlowQuery(await_value);

  if (!usesQuerySyntax(await_value)) {
    return normalized_await === '' ? [] : [normalized_await];
  }

  /** @type {string[]} */
  const signal_kinds = [];
  const kind_pattern = /\bkind\s*=\s*([A-Za-z_][\w-]*)\b/gu;

  for (const match of normalized_await.matchAll(kind_pattern)) {
    signal_kinds.push(match[1]);
  }

  return [...new Set(signal_kinds)];
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
  const state_machine_jobs = job_entries.filter(([, job_definition]) =>
    isStateMachineJobDefinition(job_definition),
  );
  const legacy_jobs = job_entries.filter(([, job_definition]) =>
    isLegacyJobDefinition(job_definition),
  );

  if (
    state_machine_jobs.length === 0 &&
    !Object.hasOwn(flow_definition, 'workspace')
  ) {
    return [];
  }

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

  if (legacy_jobs.length > 0) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'State-machine jobs must not be mixed with legacy step-based jobs in the same flow.',
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

  if (workspace_definition.type !== 'git.workspace') {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.type to be "git.workspace".`,
      ),
    ];
  }

  if (!isPlainObject(workspace_definition.source)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.source to be an object.`,
      ),
    ];
  }

  if (workspace_definition.source.kind !== 'repo') {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.source.kind to be "repo".`,
      ),
    ];
  }

  if (
    typeof workspace_definition.source.id !== 'string' ||
    workspace_definition.source.id.trim() === ''
  ) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.source.id to be a non-empty string.`,
      ),
    ];
  }

  if (!isPlainObject(workspace_definition.materialize)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.materialize to be an object.`,
      ),
    ];
  }

  if (workspace_definition.materialize.kind !== 'worktree') {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.materialize.kind to be "worktree".`,
      ),
    ];
  }

  if (
    workspace_definition.materialize.mode !== 'ephemeral' &&
    workspace_definition.materialize.mode !== 'pooled'
  ) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.materialize.mode to be "ephemeral" or "pooled".`,
      ),
    ];
  }

  if (
    typeof workspace_definition.materialize.ref !== 'string' ||
    workspace_definition.materialize.ref.trim() === ''
  ) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path}.materialize.ref to be a non-empty string.`,
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
    'await',
    'needs',
    'relate',
    'select',
    'steps',
    'transition',
    'worktree',
  ]) {
    if (Object.hasOwn(job_definition, forbidden_field)) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `State-machine jobs must not define ${job_path}.${forbidden_field}.`,
        ),
      );
    }
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
 * @param {unknown} job_definition
 * @returns {job_definition is Record<string, unknown>}
 */
function isLegacyJobDefinition(job_definition) {
  return (
    isPlainObject(job_definition) &&
    (Object.hasOwn(job_definition, 'needs') ||
      Object.hasOwn(job_definition, 'select') ||
      Object.hasOwn(job_definition, 'steps') ||
      Object.hasOwn(job_definition, 'worktree'))
  );
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {SemanticModel} semantic_model
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {string[]} executable_binding_names
 */
function traverseChildNodes(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  diagnostics,
  executable_binding_names,
) {
  if (Array.isArray(flow_node)) {
    flow_node.forEach((child_node, index) => {
      validateFlowNode(
        child_node,
        flow_file_path,
        `${node_path}[${index}]`,
        semantic_model,
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
      semantic_model,
      diagnostics,
      executable_binding_names,
      child_key,
    );
  }
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @param {SemanticModel | null} semantic_model
 * @returns {{
 *   binding_names: string[],
 *   diagnostics: ValidationDiagnostic[],
 * }}
 */
function collectFlowTriggerDiagnostics(
  flow_definition,
  flow_file_path,
  semantic_model,
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
          'Expected flow.on to define exactly one durable trigger binding.',
        ),
        ...collectJobSelectDiagnostics(flow_definition, flow_file_path),
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

  if (on_entries.length !== 1) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on to define exactly one durable trigger binding.',
      ),
    );
  }

  /** @type {string[]} */
  const binding_names = [];

  for (const [binding_name, trigger_definition] of on_entries) {
    const trigger_path = `flow.on.${binding_name}`;

    if (binding_name === 'document') {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Reserved trigger binding name "${binding_name}" is not allowed at ${trigger_path}.`,
        ),
      );
      continue;
    }

    if (!isPlainObject(trigger_definition)) {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${trigger_path} to be an object.`,
        ),
      );
      continue;
    }

    if (typeof trigger_definition.where !== 'string') {
      diagnostics.push(
        createDiagnostic(
          flow_file_path,
          `Expected ${trigger_path}.where to be a string.`,
        ),
      );
      continue;
    }

    if (semantic_model !== null) {
      diagnostics.push(
        ...validateSelectQueryText(
          trigger_definition.where,
          flow_file_path,
          `${trigger_path}.where`,
          semantic_model.semantic_role_names,
        ),
      );
    }
    binding_names.push(binding_name);
  }

  diagnostics.push(
    ...collectJobSelectDiagnostics(flow_definition, flow_file_path),
  );

  return {
    binding_names,
    diagnostics,
  };
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @returns {ValidationDiagnostic[]}
 */
function collectJobSelectDiagnostics(flow_definition, flow_file_path) {
  /* istanbul ignore next -- parseFlowDefinition rejects non-mapping jobs before validation runs */
  if (!isPlainObject(flow_definition.jobs)) {
    return [];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const [job_name, job_definition] of Object.entries(
    flow_definition.jobs,
  )) {
    if (
      !isPlainObject(job_definition) ||
      !Object.hasOwn(job_definition, 'select')
    ) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        `Flow jobs must not define flow.jobs.${job_name}.select because root-level on.<binding>.where owns durable instance selection.`,
      ),
    );
  }

  return diagnostics;
}
