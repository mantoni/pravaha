import { readFile } from 'node:fs/promises';

import { parseAllDocuments } from 'yaml';

import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';

export { loadLegacyStateMachineDefinition };

/**
 * @param {string} file_path
 * @returns {Promise<{
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   flow_definition: Record<string, unknown> | null,
 * }>}
 */
async function loadLegacyStateMachineDefinition(file_path) {
  const flow_document_text = await readFile(file_path, 'utf8');
  const flow_definition = parseYamlSource(flow_document_text, file_path);

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
 * @param {string} yaml_text
 * @param {string} flow_file_path
 * @returns {Record<string, unknown> | Array<{ file_path: string, message: string }>}
 */
function parseYamlSource(yaml_text, flow_file_path) {
  const parsed_flow_documents = parseAllDocuments(yaml_text, {
    prettyErrors: false,
  });

  if (parsed_flow_documents.length !== 1) {
    return [
      createDiagnostic(
        flow_file_path,
        'Flow documents must contain exactly one YAML document.',
      ),
    ];
  }

  const [parsed_flow_document] = parsed_flow_documents;

  if (parsed_flow_document.errors.length > 0) {
    return parsed_flow_document.errors.map((error) =>
      createDiagnostic(
        flow_file_path,
        `Invalid YAML flow definition: ${error.message}`,
      ),
    );
  }

  const flow_definition = readYamlDocumentValue(parsed_flow_document);

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
 * @param {{ toJSON: () => unknown }} parsed_flow_document
 * @returns {unknown}
 */
function readYamlDocumentValue(parsed_flow_document) {
  return parsed_flow_document.toJSON();
}
