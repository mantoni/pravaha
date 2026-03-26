/** @import { ValidationDiagnostic } from './validation.types.ts' */

import { parseWhereClause } from 'patram';

import { createDiagnostic } from './validation-helpers.js';

export {
  compileFlowQuery,
  createQueryBindings,
  normalizeFlowQuery,
  resolveSelectQueryRole,
  usesQuerySyntax,
  validateExecutableQueryText,
  validateSelectQueryText,
};

const QUERY_OPERATOR_PATTERN =
  /[$()[\]=<>]| and | or | not | any\(|count\(|none\(/u;
const SELECT_CLASS_EQUALS_PATTERN = /\$class\s*=\s*([$\w-]+)/gu;
const SELECT_CLASS_LIST_PATTERN = /\$class\s+in\s+\[([^\]]+)\]/gu;
const SELECT_QUERY_BINDINGS = Object.freeze({
  document: 'binding:document',
});
const EXECUTABLE_QUERY_BINDINGS = Object.freeze({
  document: 'binding:document',
  task: 'binding:task',
});

/**
 * @param {string} query_text
 * @returns {string}
 */
function compileFlowQuery(query_text) {
  return normalizeFlowQuery(query_text);
}

/**
 * @param {Record<string, string>} relation_bindings
 * @returns {{ bindings: Record<string, string> } | undefined}
 */
function createQueryBindings(relation_bindings) {
  const binding_entries = Object.entries(relation_bindings).filter(
    ([, binding_value]) => typeof binding_value === 'string',
  );

  if (binding_entries.length === 0) {
    return undefined;
  }

  return {
    bindings: Object.fromEntries(binding_entries),
  };
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function normalizeFlowQuery(query_text) {
  return query_text.replaceAll(/==/gu, '=').replaceAll(/\s+/gu, ' ').trim();
}

/**
 * @param {string} query_text
 * @param {Set<string>} semantic_role_names
 * @returns {string}
 */
function resolveSelectQueryRole(query_text, semantic_role_names) {
  const class_names = collectSelectClassNames(query_text);

  if (class_names.length === 0) {
    throw new Error(
      'Select queries must constrain $class to exactly one durable semantic role.',
    );
  }

  if (class_names.some((class_name) => class_name.startsWith('$'))) {
    throw new Error(
      'Reserved runtime classes are not allowed in select queries.',
    );
  }

  const unique_class_names = [...new Set(class_names)];

  if (unique_class_names.length !== 1) {
    throw new Error(
      'Select queries must constrain $class to exactly one durable semantic role.',
    );
  }

  const [selected_role] = unique_class_names;

  if (!semantic_role_names.has(selected_role)) {
    throw new Error(
      `Unknown semantic role "${selected_role}" in select query.`,
    );
  }

  return selected_role;
}

/**
 * @param {string} select_text
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {Set<string>} semantic_role_names
 * @returns {ValidationDiagnostic[]}
 */
function validateSelectQueryText(
  select_text,
  flow_file_path,
  node_path,
  semantic_role_names,
) {
  const query_diagnostics = validateQueryText(
    select_text,
    flow_file_path,
    node_path,
    SELECT_QUERY_BINDINGS,
  );

  if (query_diagnostics.length > 0) {
    return query_diagnostics;
  }

  try {
    resolveSelectQueryRole(select_text, semantic_role_names);

    return [];
  } catch (error) {
    const error_message = readErrorMessage(error);

    return [
      createDiagnostic(
        flow_file_path,
        error_message ===
          'Reserved runtime classes are not allowed in select queries.'
          ? `Reserved runtime classes are not allowed in ${node_path}.`
          : `${error_message} in ${node_path}.`,
      ),
    ];
  }
}

/**
 * @param {string} query_text
 * @param {string} flow_file_path
 * @param {string} node_path
 * @returns {ValidationDiagnostic[]}
 */
function validateExecutableQueryText(query_text, flow_file_path, node_path) {
  return validateQueryText(
    query_text,
    flow_file_path,
    node_path,
    EXECUTABLE_QUERY_BINDINGS,
  );
}

/**
 * @param {string} query_text
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {Record<string, string>} query_bindings
 * @returns {ValidationDiagnostic[]}
 */
function validateQueryText(
  query_text,
  flow_file_path,
  node_path,
  query_bindings,
) {
  const parse_result = parseWhereClause(normalizeFlowQuery(query_text), {
    bindings: query_bindings,
  });

  if (parse_result.success) {
    return [];
  }

  return [
    createDiagnostic(
      flow_file_path,
      `${parse_result.diagnostic.message} at ${node_path}.`,
    ),
  ];
}

/**
 * @param {string} query_text
 * @returns {string[]}
 */
function collectSelectClassNames(query_text) {
  const normalized_query = normalizeFlowQuery(query_text);
  /** @type {string[]} */
  const class_names = [];

  for (const match of normalized_query.matchAll(SELECT_CLASS_EQUALS_PATTERN)) {
    class_names.push(match[1]);
  }

  for (const match of normalized_query.matchAll(SELECT_CLASS_LIST_PATTERN)) {
    class_names.push(
      ...match[1]
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );
  }

  return class_names;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function usesQuerySyntax(text) {
  return QUERY_OPERATOR_PATTERN.test(text);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown flow query error';
}
