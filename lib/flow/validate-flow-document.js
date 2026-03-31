/* eslint-disable max-lines */
/** @import { PatramModel, ValidationDiagnostic } from '../shared/types/validation.types.ts' */

import { dirname } from 'node:path';

import { collectJavaScriptFlowDiagnostics } from './javascript-flow-module.js';
import { loadFlowDefinition } from './load-flow-definition.js';
import {
  validateExecutableQueryText,
  validateSelectQueryText,
} from './query.js';
import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';

export { validateFlowDocument };

/**
 * @param {string} _flow_document_text
 * @param {string} flow_file_path
 * @param {PatramModel | null} patram_model
 * @param {{
 *   repo_directory?: string,
 * }} [options]
 * @returns {Promise<ValidationDiagnostic[]>}
 */
async function validateFlowDocument(
  _flow_document_text,
  flow_file_path,
  patram_model,
  options = {},
) {
  const load_result = await loadFlowDefinition(
    options.repo_directory ?? dirname(flow_file_path),
    flow_file_path,
  );

  if (load_result.flow_definition === null) {
    return load_result.diagnostics;
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  diagnostics.push(
    ...collectJavaScriptFlowDiagnostics(
      load_result.flow_definition,
      flow_file_path,
    ),
  );
  diagnostics.push(
    ...collectWorkspaceDiagnostics(
      load_result.flow_definition.workspace,
      flow_file_path,
      'flow.workspace',
    ),
  );

  const trigger_validation = collectFlowTriggerDiagnostics(
    load_result.flow_definition,
    flow_file_path,
    patram_model,
  );

  diagnostics.push(...trigger_validation.diagnostics);

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
  if (typeof workspace_definition !== 'string') {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to be a string for JavaScript flow modules.`,
      ),
    ];
  }

  if (workspace_definition.trim() === '') {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${node_path} to be a non-empty string.`,
      ),
    ];
  }

  return [];
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @param {PatramModel | null} patram_model
 * @returns {{
 *   binding_names: string[],
 *   diagnostics: ValidationDiagnostic[],
 * }}
 */
function collectFlowTriggerDiagnostics(
  flow_definition,
  flow_file_path,
  patram_model,
) {
  const on_definition = flow_definition.on;
  const on_definition_result = readOnDefinitionDiagnostics(
    on_definition,
    flow_file_path,
  );

  if (on_definition_result.on_definition === null) {
    return {
      binding_names: [],
      diagnostics: on_definition_result.diagnostics,
    };
  }

  const diagnostics = [...on_definition_result.diagnostics];

  if (typeof on_definition_result.on_definition.patram === 'string') {
    if (patram_model === null) {
      diagnostics.push(
        ...validateExecutableQueryText(
          on_definition_result.on_definition.patram,
          flow_file_path,
          'flow.on.patram',
        ),
      );
    } else {
      diagnostics.push(
        ...validateSelectQueryText(
          on_definition_result.on_definition.patram,
          flow_file_path,
          'flow.on.patram',
          patram_model.class_names,
        ),
      );
    }
  }

  const owner_class =
    typeof on_definition_result.on_definition.patram === 'string'
      ? readOptionalOwnerClass(on_definition_result.on_definition.patram)
      : '';

  return {
    binding_names: owner_class === '' ? [] : [owner_class],
    diagnostics,
  };
}

/**
 * @param {unknown} on_definition
 * @param {string} flow_file_path
 * @returns {{
 *   diagnostics: ValidationDiagnostic[],
 *   on_definition: {
 *     file?: string,
 *     patram?: string,
 *     prompt?: boolean,
 *   } | null,
 * }}
 */
// eslint-disable-next-line complexity, max-lines-per-function
function readOnDefinitionDiagnostics(on_definition, flow_file_path) {
  if (on_definition === undefined) {
    return {
      diagnostics: [
        createDiagnostic(
          flow_file_path,
          'Expected flow.on to define at least one supported trigger.',
        ),
      ],
      on_definition: null,
    };
  }

  if (!isPlainObject(on_definition)) {
    return {
      diagnostics: [
        createDiagnostic(flow_file_path, 'Expected flow.on to be an object.'),
      ],
      on_definition: null,
    };
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];
  const supported_keys = new Set(['file', 'patram', 'prompt']);
  const on_entries = Object.entries(on_definition);

  if (
    on_entries.length === 0 ||
    on_entries.some(([entry_name]) => supported_keys.has(entry_name) === false)
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on to define only supported patram, file, and prompt triggers.',
      ),
    );
  }

  if (
    Object.hasOwn(on_definition, 'patram') &&
    typeof on_definition.patram !== 'string'
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on.patram to be a string.',
      ),
    );
  }

  if (
    Object.hasOwn(on_definition, 'file') &&
    typeof on_definition.file !== 'string'
  ) {
    diagnostics.push(
      createDiagnostic(flow_file_path, 'Expected flow.on.file to be a string.'),
    );
  }

  if (
    typeof on_definition.file === 'string' &&
    on_definition.file.trim() === ''
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on.file to be a non-empty string.',
      ),
    );
  }

  if (
    Object.hasOwn(on_definition, 'prompt') &&
    typeof on_definition.prompt !== 'boolean'
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on.prompt to be a boolean.',
      ),
    );
  }

  if (
    typeof on_definition.patram === 'string' &&
    on_definition.prompt === true
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on.prompt to be omitted when flow.on.patram is defined.',
      ),
    );
  }

  if (
    typeof on_definition.patram !== 'string' &&
    typeof on_definition.file !== 'string' &&
    on_definition.prompt !== true
  ) {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'Expected flow.on to define at least one supported trigger.',
      ),
    );
  }

  if (diagnostics.length > 0) {
    return {
      diagnostics,
      on_definition: null,
    };
  }

  return {
    diagnostics,
    on_definition: {
      ...(typeof on_definition.file === 'string'
        ? { file: on_definition.file }
        : {}),
      ...(typeof on_definition.patram === 'string'
        ? { patram: on_definition.patram }
        : {}),
      ...(typeof on_definition.prompt === 'boolean'
        ? { prompt: on_definition.prompt }
        : {}),
    },
  };
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function readOwnerClass(query_text) {
  const class_matches = query_text
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .matchAll(/\$class\s*(?:==|=)\s*([$\w-]+)|\$class\s+in\s+\[([^\]]+)\]/gu);
  /** @type {string[]} */
  const class_names = [];

  for (const match of class_matches) {
    if (typeof match[1] === 'string') {
      class_names.push(match[1]);
      continue;
    }

    if (typeof match[2] === 'string') {
      class_names.push(
        ...match[2]
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      );
    }
  }

  const unique_class_names = [...new Set(class_names)].filter(
    (class_name) => !class_name.startsWith('$'),
  );

  if (unique_class_names.length !== 1) {
    throw new Error('Expected exactly one owner class.');
  }

  return unique_class_names[0];
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function readOptionalOwnerClass(query_text) {
  try {
    return readOwnerClass(query_text);
  } catch {
    return '';
  }
}
