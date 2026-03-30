import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseAllDocuments } from 'yaml';

import { assertValidFlow } from './flow-contract.js';
import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';

export { loadFlowDefinition };

const FLOW_MODULE_EXTENSIONS = new Set(['.js', '.mjs']);

/**
 * @param {string | undefined} repo_directory
 * @param {string} flow_path
 * @param {string} [flow_document_text]
 * @returns {Promise<{
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   flow_definition: Record<string, unknown> | null,
 *   surface: 'javascript-module' | 'state-machine' | null,
 * }>}
 */
async function loadFlowDefinition(
  repo_directory,
  flow_path,
  flow_document_text,
) {
  if (isJavaScriptFlowPath(flow_path)) {
    return loadJavaScriptFlowDefinition(repo_directory, flow_path);
  }

  const yaml_text =
    flow_document_text ??
    (await readFile(resolveFlowFilePath(repo_directory, flow_path), 'utf8'));
  const parse_result = parseFlowDefinition(yaml_text, flow_path);

  return {
    ...parse_result,
    surface: parse_result.flow_definition === null ? null : 'state-machine',
  };
}

/**
 * @param {string} flow_document_text
 * @param {string} flow_file_path
 * @returns {{ diagnostics: Array<{ file_path: string, message: string }>, flow_definition: Record<string, unknown> | null }}
 */
function parseFlowDefinition(flow_document_text, flow_file_path) {
  const flow_definition = parseYamlSource(flow_document_text, flow_file_path);

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
 * @param {string | undefined} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   flow_definition: Record<string, unknown> | null,
 *   surface: 'javascript-module' | null,
 * }>}
 */
async function loadJavaScriptFlowDefinition(repo_directory, flow_path) {
  try {
    const module_path = resolveFlowFilePath(repo_directory, flow_path);
    const module_namespace = await loadModuleNamespace(module_path);

    return {
      diagnostics: [],
      flow_definition: assertValidFlow(module_namespace.default, flow_path),
      surface: 'javascript-module',
    };
  } catch (error) {
    return {
      diagnostics: [
        createDiagnostic(
          flow_path,
          `Cannot load JavaScript flow module: ${readErrorMessage(error)}`,
        ),
      ],
      flow_definition: null,
      surface: null,
    };
  }
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
 * @param {string | undefined} repo_directory
 * @param {string} flow_path
 * @returns {string}
 */
function resolveFlowFilePath(repo_directory, flow_path) {
  if (isAbsolute(flow_path)) {
    return flow_path;
  }

  if (typeof repo_directory !== 'string' || repo_directory.trim() === '') {
    throw new Error(
      `Cannot resolve relative flow path "${flow_path}" without a repo directory.`,
    );
  }

  return join(repo_directory, flow_path);
}

/**
 * @param {string} flow_path
 * @returns {boolean}
 */
function isJavaScriptFlowPath(flow_path) {
  return Array.from(FLOW_MODULE_EXTENSIONS).some((extension) =>
    flow_path.endsWith(extension),
  );
}

/**
 * @param {string} module_path
 * @returns {Promise<{ default: unknown }>}
 */
async function loadModuleNamespace(module_path) {
  const module_url = pathToFileURL(module_path);
  const module_stats = await stat(module_path);

  module_url.searchParams.set(
    'pravaha_flow_mtime',
    String(module_stats.mtimeMs),
  );

  const module_namespace = /** @type {unknown} */ (
    await import(module_url.href)
  );

  return /** @type {{ default: unknown }} */ (module_namespace);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {{ toJSON: () => unknown }} parsed_flow_document
 * @returns {unknown}
 */
function readYamlDocumentValue(parsed_flow_document) {
  return parsed_flow_document.toJSON();
}
