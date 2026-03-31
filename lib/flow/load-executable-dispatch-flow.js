import {
  assertValidJavaScriptFlowDefinition,
  collectJavaScriptFlowHandlers,
} from './javascript-flow-module.js';
import { normalizeFlowQuery, resolveDurableQueryClass } from './query.js';
import { loadFlowDefinition } from './load-flow-definition.js';
import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

export { loadExecutableDispatchFlow };

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   flow: {
 *     handlers: Record<string, Function>,
 *     trigger: {
 *       file_glob: string | null,
 *       owner_class: string | null,
 *       prompt_enabled: boolean,
 *       query_text: string | null,
 *     },
 *     workspace: string,
 *   },
 *   surface: 'javascript-module',
 * }>}
 */
async function loadExecutableDispatchFlow(repo_directory, flow_path) {
  const flow_definition = await readFlowDefinition(repo_directory, flow_path);
  return {
    flow: interpretJavaScriptFlow(flow_definition, flow_path),
    surface: 'javascript-module',
  };
}

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readFlowDefinition(repo_directory, flow_path) {
  const load_result = await loadFlowDefinition(repo_directory, flow_path);

  if (
    load_result.diagnostics.length > 0 ||
    load_result.flow_definition === null ||
    load_result.surface === null
  ) {
    throw new Error(formatDiagnostics(load_result.diagnostics));
  }

  return load_result.flow_definition;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_path
 * @returns {{
 *   handlers: Record<string, Function>,
 *   trigger: {
 *     file_glob: string | null,
 *     owner_class: string | null,
 *     prompt_enabled: boolean,
 *     query_text: string | null,
 *   },
 *   workspace: string,
 * }}
 */
function interpretJavaScriptFlow(flow_definition, flow_path) {
  const validated_flow_definition = assertValidJavaScriptFlowDefinition(
    flow_definition,
    flow_path,
  );

  return {
    handlers: collectJavaScriptFlowHandlers(validated_flow_definition),
    trigger: interpretFlowTriggerDefinition(
      validated_flow_definition.on,
      flow_path,
    ),
    workspace: interpretFlowWorkspace(
      validated_flow_definition.workspace,
      flow_path,
    ),
  };
}

/**
 * @param {unknown} workspace_definition
 * @param {string} flow_path
 * @returns {string}
 */
function interpretFlowWorkspace(workspace_definition, flow_path) {
  if (typeof workspace_definition !== 'string') {
    throw new Error(
      `Expected ${flow_path} workspace to be a non-empty string.`,
    );
  }

  if (workspace_definition.trim() === '') {
    throw new Error(
      `Expected ${flow_path} workspace to be a non-empty string.`,
    );
  }

  return workspace_definition;
}

/**
 * @param {unknown} on_definition
 * @param {string} flow_path
 * @returns {{
 *   file_glob: string | null,
 *   owner_class: string | null,
 *   prompt_enabled: boolean,
 *   query_text: string | null,
 * }}
 */
function interpretFlowTriggerDefinition(on_definition, flow_path) {
  if (!isPlainObject(on_definition)) {
    throw new Error(
      `Expected ${flow_path} to define flow.on with supported patram, file, and prompt triggers.`,
    );
  }

  const on_entries = Object.entries(on_definition);
  const supported_keys = new Set(['file', 'patram', 'prompt']);

  if (
    on_entries.length === 0 ||
    on_entries.some(([entry_name]) => supported_keys.has(entry_name) === false)
  ) {
    throw new Error(
      `Expected ${flow_path} to define flow.on with supported patram, file, and prompt triggers.`,
    );
  }

  const normalized_query =
    typeof on_definition.patram === 'string'
      ? normalizeFlowQuery(on_definition.patram)
      : null;

  return {
    file_glob:
      typeof on_definition.file === 'string' ? on_definition.file : null,
    owner_class:
      normalized_query === null
        ? null
        : resolveDurableQueryClass(normalized_query),
    prompt_enabled: on_definition.prompt === true,
    query_text: normalized_query,
  };
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
