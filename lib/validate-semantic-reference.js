/** @import { ValidationDiagnostic } from './validation.types.ts' */

import { createDiagnostic, isPlainObject } from './validation-helpers.js';

export {
  validateRelateReference,
  validateSemanticRoleReference,
  validateSemanticStateReference,
};

/**
 * @param {unknown} select_value
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {Set<string>} semantic_role_names
 * @returns {ValidationDiagnostic[]}
 */
function validateSemanticRoleReference(
  select_value,
  flow_file_path,
  node_path,
  semantic_role_names,
) {
  return validateSemanticReferenceNode(
    select_value,
    flow_file_path,
    node_path,
    'role',
    semantic_role_names,
    ['role', 'roles'],
  );
}

/**
 * @param {unknown} transition_value
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {Set<string>} semantic_state_names
 * @returns {ValidationDiagnostic[]}
 */
function validateSemanticStateReference(
  transition_value,
  flow_file_path,
  node_path,
  semantic_state_names,
) {
  return validateSemanticReferenceNode(
    transition_value,
    flow_file_path,
    node_path,
    'state',
    semantic_state_names,
    ['state', 'states', 'to'],
  );
}

/**
 * @param {unknown} relate_value
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {Set<string>} semantic_role_names
 * @returns {ValidationDiagnostic[]}
 */
function validateRelateReference(
  relate_value,
  flow_file_path,
  node_path,
  semantic_role_names,
) {
  if (!isPlainObject(relate_value)) {
    return [];
  }

  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const key_name of ['role', 'roles', 'from_role', 'to_role']) {
    if (!Object.hasOwn(relate_value, key_name)) {
      continue;
    }

    diagnostics.push(
      ...validateSemanticReferenceValue(
        relate_value[key_name],
        flow_file_path,
        `${node_path}.${key_name}`,
        'role',
        semantic_role_names,
      ),
    );
  }

  return diagnostics;
}

/**
 * @param {unknown} reference_node
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {'role' | 'state'} semantic_label
 * @param {Set<string>} allowed_names
 * @param {string[]} object_keys
 * @returns {ValidationDiagnostic[]}
 */
function validateSemanticReferenceNode(
  reference_node,
  flow_file_path,
  node_path,
  semantic_label,
  allowed_names,
  object_keys,
) {
  if (typeof reference_node === 'string' || Array.isArray(reference_node)) {
    return validateSemanticReferenceValue(
      reference_node,
      flow_file_path,
      node_path,
      semantic_label,
      allowed_names,
    );
  }

  if (!isPlainObject(reference_node)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Unsupported ${semantic_label} reference shape at ${node_path}.`,
      ),
    ];
  }

  const referenced_keys = object_keys.filter((key_name) =>
    Object.hasOwn(reference_node, key_name),
  );

  if (referenced_keys.length === 0) {
    return [
      createDiagnostic(
        flow_file_path,
        `Unsupported ${semantic_label} reference shape at ${node_path}.`,
      ),
    ];
  }

  return referenced_keys.flatMap((key_name) =>
    validateSemanticReferenceValue(
      reference_node[key_name],
      flow_file_path,
      `${node_path}.${key_name}`,
      semantic_label,
      allowed_names,
    ),
  );
}

/**
 * @param {unknown} reference_value
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {'role' | 'state'} semantic_label
 * @param {Set<string>} allowed_names
 * @returns {ValidationDiagnostic[]}
 */
function validateSemanticReferenceValue(
  reference_value,
  flow_file_path,
  node_path,
  semantic_label,
  allowed_names,
) {
  if (typeof reference_value === 'string') {
    return validateSemanticName(
      reference_value,
      flow_file_path,
      node_path,
      semantic_label,
      allowed_names,
    );
  }

  if (!Array.isArray(reference_value)) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${semantic_label} reference at ${node_path} to be a string or string array.`,
      ),
    ];
  }

  return reference_value.flatMap((semantic_name, index) =>
    validateSemanticName(
      semantic_name,
      flow_file_path,
      `${node_path}[${index}]`,
      semantic_label,
      allowed_names,
    ),
  );
}

/**
 * @param {unknown} semantic_name
 * @param {string} flow_file_path
 * @param {string} node_path
 * @param {'role' | 'state'} semantic_label
 * @param {Set<string>} allowed_names
 * @returns {ValidationDiagnostic[]}
 */
function validateSemanticName(
  semantic_name,
  flow_file_path,
  node_path,
  semantic_label,
  allowed_names,
) {
  if (typeof semantic_name !== 'string' || semantic_name.length === 0) {
    return [
      createDiagnostic(
        flow_file_path,
        `Expected ${semantic_label} reference at ${node_path} to be a non-empty string.`,
      ),
    ];
  }

  if (allowed_names.has(semantic_name)) {
    return [];
  }

  return [
    createDiagnostic(
      flow_file_path,
      `Unknown semantic ${semantic_label} "${semantic_name}" at ${node_path}.`,
    ),
  ];
}
