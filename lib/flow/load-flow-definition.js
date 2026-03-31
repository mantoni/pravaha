import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertValidFlow } from './flow-contract.js';
import { createDiagnostic } from '../shared/diagnostics/validation-helpers.js';

export { loadFlowDefinition };

const FLOW_MODULE_EXTENSIONS = new Set(['.js', '.mjs']);

/**
 * @param {string | undefined} repo_directory
 * @param {string} flow_path
 * @param {string} [flow_document_text]
 * @returns {Promise<{
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   flow_definition: Record<string, unknown> | null,
 *   surface: 'javascript-module' | null,
 * }>}
 */
async function loadFlowDefinition(
  repo_directory,
  flow_path,
  flow_document_text,
) {
  if (!isJavaScriptFlowPath(flow_path)) {
    return {
      diagnostics: [
        createDiagnostic(
          flow_path,
          'Flow definition files must use .js or .mjs and default-export defineFlow(...). YAML flow documents are no longer supported.',
        ),
      ],
      flow_definition: null,
      surface: null,
    };
  }

  void flow_document_text;
  return loadJavaScriptFlowDefinition(repo_directory, flow_path);
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
