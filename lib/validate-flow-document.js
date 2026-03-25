/** @import { SemanticModel, ValidationDiagnostic } from './validation.types.ts' */

import { parseFlowDefinition } from './load-flow-definition.js';
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

  if (semantic_model === null) {
    return [];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

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
    return validateSemanticRoleReference(
      flow_node,
      flow_file_path,
      node_path,
      semantic_model.semantic_role_names,
    );
  }

  if (node_key === 'transition') {
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
