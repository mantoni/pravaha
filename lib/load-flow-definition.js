import { parseDocument } from 'yaml';

import { createDiagnostic, isPlainObject } from './validation-helpers.js';

export { parseFlowDefinition };

/**
 * @param {string} flow_document_text
 * @param {string} flow_file_path
 * @returns {{ diagnostics: Array<{ file_path: string, message: string }>, flow_definition: Record<string, unknown> | null }}
 */
function parseFlowDefinition(flow_document_text, flow_file_path) {
  const yaml_block = resolveYamlBlock(flow_document_text, flow_file_path);

  if (Array.isArray(yaml_block)) {
    return {
      diagnostics: yaml_block,
      flow_definition: null,
    };
  }

  const flow_definition = parseYamlBlock(yaml_block, flow_file_path);

  if (Array.isArray(flow_definition)) {
    return {
      diagnostics: flow_definition,
      flow_definition: null,
    };
  }

  return {
    diagnostics: [],
    flow_definition,
  };
}

/**
 * @param {string} markdown_text
 * @param {string} flow_file_path
 * @returns {string | Array<{ file_path: string, message: string }>}
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
 * @returns {Record<string, unknown> | Array<{ file_path: string, message: string }>}
 */
function parseYamlBlock(yaml_block, flow_file_path) {
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
