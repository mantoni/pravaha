/** @import { SemanticModel, ValidationDiagnostic } from './validation.types.ts' */

import { parseDocument } from 'yaml';

import { createDiagnostic, isPlainObject } from './validation-helpers.js';
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
  const yaml_block = resolveYamlBlock(flow_document_text, flow_file_path);

  if (Array.isArray(yaml_block)) {
    return yaml_block;
  }

  const flow_definition = parseFlowDefinition(yaml_block, flow_file_path);

  if (Array.isArray(flow_definition)) {
    return flow_definition;
  }

  if (semantic_model === null) {
    return [];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  validateFlowNode(
    flow_definition,
    flow_file_path,
    'flow',
    semantic_model,
    diagnostics,
  );

  return diagnostics;
}

/**
 * @param {string} markdown_text
 * @param {string} flow_file_path
 * @returns {string | ValidationDiagnostic[]}
 */
function resolveYamlBlock(markdown_text, flow_file_path) {
  const yaml_blocks = extractYamlBlocks(markdown_text);

  if (yaml_blocks.length === 1) {
    return yaml_blocks[0];
  }

  if (yaml_blocks.length === 0) {
    return [
      createDiagnostic(
        flow_file_path,
        'Flow documents must contain exactly one fenced ```yaml``` block.',
      ),
    ];
  }

  return [
    createDiagnostic(
      flow_file_path,
      'Flow documents must not contain more than one fenced ```yaml``` block.',
    ),
  ];
}

/**
 * @param {string} yaml_block
 * @param {string} flow_file_path
 * @returns {Record<string, unknown> | ValidationDiagnostic[]}
 */
function parseFlowDefinition(yaml_block, flow_file_path) {
  const parsed_flow_document = parseDocument(yaml_block, {
    prettyErrors: false,
  });

  if (parsed_flow_document.errors.length > 0) {
    return parsed_flow_document.errors.map((error) =>
      createDiagnostic(
        flow_file_path,
        `Invalid YAML flow definition: ${error.message}`,
      ),
    );
  }

  const flow_definition = parsed_flow_document.toJSON();

  if (!isPlainObject(flow_definition)) {
    return [
      createDiagnostic(flow_file_path, 'Flow YAML must evaluate to an object.'),
    ];
  }

  if (!isPlainObject(flow_definition.jobs)) {
    return [
      createDiagnostic(
        flow_file_path,
        'Flow YAML must define a top-level "jobs" mapping.',
      ),
    ];
  }

  return flow_definition;
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

/**
 * @param {string} markdown_text
 * @returns {string[]}
 */
function extractYamlBlocks(markdown_text) {
  /** @type {string[]} */
  const yaml_blocks = [];
  const yaml_block_expression = /^```yaml\r?\n([\s\S]*?)\r?\n```$/gm;

  for (const match of markdown_text.matchAll(yaml_block_expression)) {
    yaml_blocks.push(match[1]);
  }

  return yaml_blocks;
}
