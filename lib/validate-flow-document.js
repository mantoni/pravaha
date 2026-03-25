/** @import { SemanticModel, ValidationDiagnostic } from './validation.types.ts' */

import { parseFlowDefinition } from './load-flow-definition.js';
import { validateSelectQueryText } from './flow-query.js';
import { isPlainObject } from './validation-helpers.js';
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
 * @returns {ValidationDiagnostic[]}
 */
function validateFlowDocument(
  flow_document_text,
  flow_file_path,
  semantic_model,
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
