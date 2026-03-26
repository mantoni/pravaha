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
    ...(await collectPluginDiagnostics(
      parse_result.flow_definition,
      flow_file_path,
      options.repo_directory ?? dirname(flow_file_path),
    )),
  );

  if (semantic_model === null) {
    return diagnostics;
  }

  validateFlowNode(
    parse_result.flow_definition,
    flow_file_path,
    'flow',
    semantic_model,
    diagnostics,
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
 * @param {string} [node_key]
 */
function validateFlowNode(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  diagnostics,
  node_key,
) {
  diagnostics.push(
    ...collectNodeDiagnostics(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model,
      node_key,
    ),
  );
  traverseChildNodes(
    flow_node,
    flow_file_path,
    node_path,
    semantic_model,
    diagnostics,
  );
}

/**
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {SemanticModel} semantic_model
 * @param {string} [node_key]
 * @returns {ValidationDiagnostic[]}
 */
function collectNodeDiagnostics(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  node_key,
) {
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
      return validateExecutableQueryText(flow_node, flow_file_path, node_path);
    }
  }

  if (node_key === 'if') {
    if (typeof flow_node === 'string') {
      return validateExecutableQueryText(flow_node, flow_file_path, node_path);
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
    if (
      !isPlainObject(job_definition) ||
      !Array.isArray(job_definition.steps)
    ) {
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

      const uses_value = step_definition.uses;

      if (step_plugins.has(uses_value)) {
        continue;
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
            `${readErrorMessage(error)} at flow.jobs.${job_name}.steps[${step_index}].uses.`,
          ),
        );
      }
    }
  }

  for (const [job_name, job_definition] of Object.entries(
    flow_definition.jobs,
  )) {
    if (
      !isPlainObject(job_definition) ||
      !Array.isArray(job_definition.steps)
    ) {
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
 * @param {unknown} flow_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {SemanticModel} semantic_model
 * @param {ValidationDiagnostic[]} diagnostics
 */
function traverseChildNodes(
  flow_node,
  flow_file_path,
  node_path,
  semantic_model,
  diagnostics,
) {
  if (Array.isArray(flow_node)) {
    flow_node.forEach((child_node, index) => {
      validateFlowNode(
        child_node,
        flow_file_path,
        `${node_path}[${index}]`,
        semantic_model,
        diagnostics,
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
      child_key,
    );
  }
}
