import { join } from 'node:path';

import { isPlainObject, readJsonFile } from './validation-helpers.js';

export { loadRuntimeSemantics };

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   ready_states: Set<string>,
 *   role_targets: Map<string, string[]>,
 *   terminal_states: Set<string>,
 * }>}
 */
async function loadRuntimeSemantics(repo_directory) {
  const pravaha_config_result = await readJsonFile(
    join(repo_directory, 'pravaha.json'),
  );

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(pravaha_config_result.diagnostics[0].message);
  }

  if (!isPlainObject(pravaha_config_result.value)) {
    throw new Error('Pravaha config must evaluate to an object.');
  }

  const semantic_roles = pravaha_config_result.value.semantic_roles;
  const semantic_states = pravaha_config_result.value.semantic_states;

  if (!isPlainObject(semantic_roles) || !isPlainObject(semantic_states)) {
    throw new Error(
      'Pravaha config must define object-valued semantic_roles and semantic_states mappings.',
    );
  }

  return {
    ready_states: new Set(resolveSemanticMapping(semantic_states, 'ready')),
    role_targets: new Map(
      Object.entries(semantic_roles).map(([semantic_name, target_values]) => [
        semantic_name,
        normalizeSemanticTargetValues(
          target_values,
          `semantic_roles.${semantic_name}`,
        ),
      ]),
    ),
    terminal_states: new Set(
      resolveSemanticMapping(semantic_states, 'terminal'),
    ),
  };
}

/**
 * @param {Record<string, unknown>} semantic_mapping
 * @param {string} semantic_name
 * @returns {string[]}
 */
function resolveSemanticMapping(semantic_mapping, semantic_name) {
  if (!Object.hasOwn(semantic_mapping, semantic_name)) {
    throw new Error(
      `Missing ${semantic_name} semantic mapping in pravaha.json.`,
    );
  }

  return normalizeSemanticTargetValues(
    semantic_mapping[semantic_name],
    `semantic_states.${semantic_name}`,
  );
}

/**
 * @param {unknown} target_values
 * @param {string} field_path
 * @returns {string[]}
 */
function normalizeSemanticTargetValues(target_values, field_path) {
  if (!Array.isArray(target_values)) {
    throw new Error(`Expected ${field_path} to be an array.`);
  }

  const normalized_values = target_values.filter(
    (target_value) =>
      typeof target_value === 'string' && target_value.length > 0,
  );

  if (normalized_values.length !== target_values.length) {
    throw new Error(
      `Expected ${field_path} to contain only non-empty strings.`,
    );
  }

  return normalized_values;
}
