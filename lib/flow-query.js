/** @import { ValidationDiagnostic } from './validation.types.ts' */

import { createDiagnostic } from './validation-helpers.js';

export {
  compileFlowQuery,
  normalizeFlowQuery,
  resolveSelectQueryRole,
  usesQuerySyntax,
  validateSelectQueryText,
};

const QUERY_OPERATOR_PATTERN =
  /[$()[\]=<>]| and | or | not | any\(|count\(|none\(/u;
const SELECT_CLASS_EQUALS_PATTERN = /\$class\s*=\s*([$\w-]+)/gu;
const SELECT_CLASS_LIST_PATTERN = /\$class\s+in\s+\[([^\]]+)\]/gu;

/**
 * @param {string} query_text
 * @param {Record<string, string>} relation_bindings
 * @param {Iterable<string>} relation_names
 * @returns {string}
 */
function compileFlowQuery(query_text, relation_bindings, relation_names) {
  let compiled_query = normalizeFlowQuery(query_text);

  for (const relation_name of relation_names) {
    for (const [binding_name, binding_target_id] of Object.entries(
      relation_bindings,
    )) {
      compiled_query = compiled_query.replaceAll(
        new RegExp(
          `\\b${escapeRegularExpression(relation_name)}\\s*=\\s*${escapeRegularExpression(binding_name)}\\b`,
          'gu',
        ),
        `${relation_name}=${binding_target_id}`,
      );
    }
  }

  return compiled_query;
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

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegularExpression(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
