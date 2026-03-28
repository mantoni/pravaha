/** @import { ValidationDiagnostic } from '../../shared/types/validation.types.ts' */

import { createDiagnostic } from '../../shared/diagnostics/validation-helpers.js';

export { validateSemanticMapping };

/**
 * @param {Record<string, unknown>} semantic_mapping
 * @param {Set<string>} allowed_target_names
 * @param {'semantic role' | 'semantic state'} mapping_label
 * @param {string} file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @param {string[]} [required_semantic_names]
 * @returns {Set<string> | null}
 */
function validateSemanticMapping(
  semantic_mapping,
  allowed_target_names,
  mapping_label,
  file_path,
  diagnostics,
  required_semantic_names = [],
) {
  const semantic_names = Object.keys(semantic_mapping).sort(compareText);

  if (semantic_names.length === 0) {
    diagnostics.push(
      createDiagnostic(
        file_path,
        `Pravaha config must define at least one ${mapping_label}.`,
      ),
    );

    return null;
  }

  const has_mapping_errors = validateMappedTargets(
    semantic_mapping,
    semantic_names,
    allowed_target_names,
    mapping_label,
    file_path,
    diagnostics,
  );
  const is_missing_required_name = validateRequiredSemanticNames(
    semantic_mapping,
    required_semantic_names,
    mapping_label,
    file_path,
    diagnostics,
  );

  if (has_mapping_errors || is_missing_required_name) {
    return null;
  }

  return new Set(semantic_names);
}

/**
 * @param {Record<string, unknown>} semantic_mapping
 * @param {string[]} semantic_names
 * @param {Set<string>} allowed_target_names
 * @param {'semantic role' | 'semantic state'} mapping_label
 * @param {string} file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {boolean}
 */
function validateMappedTargets(
  semantic_mapping,
  semantic_names,
  allowed_target_names,
  mapping_label,
  file_path,
  diagnostics,
) {
  /** @type {Map<string, string>} */
  const configured_targets = new Map();
  let has_error = false;

  for (const semantic_name of semantic_names) {
    const target_names = semantic_mapping[semantic_name];

    if (!Array.isArray(target_names) || target_names.length === 0) {
      diagnostics.push(
        createDiagnostic(
          file_path,
          `${formatSemanticLabel(mapping_label, semantic_name)} must map to a non-empty string array.`,
        ),
      );
      has_error = true;
      continue;
    }

    has_error =
      validateTargetNames(
        target_names,
        semantic_name,
        configured_targets,
        allowed_target_names,
        mapping_label,
        file_path,
        diagnostics,
      ) || has_error;
  }

  return has_error;
}

/**
 * @param {unknown[]} target_names
 * @param {string} semantic_name
 * @param {Map<string, string>} configured_targets
 * @param {Set<string>} allowed_target_names
 * @param {'semantic role' | 'semantic state'} mapping_label
 * @param {string} file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {boolean}
 */
function validateTargetNames(
  target_names,
  semantic_name,
  configured_targets,
  allowed_target_names,
  mapping_label,
  file_path,
  diagnostics,
) {
  let has_error = false;

  for (const target_name of target_names) {
    if (typeof target_name !== 'string' || target_name.length === 0) {
      diagnostics.push(
        createDiagnostic(
          file_path,
          `${formatSemanticLabel(mapping_label, semantic_name)} contains an invalid mapped value.`,
        ),
      );
      has_error = true;
      continue;
    }

    if (!allowed_target_names.has(target_name)) {
      diagnostics.push(
        createDiagnostic(
          file_path,
          `${formatSemanticLabel(mapping_label, semantic_name)} references unknown target "${target_name}".`,
        ),
      );
      has_error = true;
      continue;
    }

    has_error =
      validateTargetOwnership(
        target_name,
        semantic_name,
        configured_targets,
        mapping_label,
        file_path,
        diagnostics,
      ) || has_error;
  }

  return has_error;
}

/**
 * @param {string} target_name
 * @param {string} semantic_name
 * @param {Map<string, string>} configured_targets
 * @param {'semantic role' | 'semantic state'} mapping_label
 * @param {string} file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {boolean}
 */
function validateTargetOwnership(
  target_name,
  semantic_name,
  configured_targets,
  mapping_label,
  file_path,
  diagnostics,
) {
  const existing_name = configured_targets.get(target_name);

  if (existing_name === undefined || existing_name === semantic_name) {
    configured_targets.set(target_name, semantic_name);

    return false;
  }

  diagnostics.push(
    createDiagnostic(
      file_path,
      `Mapped target "${target_name}" is assigned to both ${mapping_label}s "${existing_name}" and "${semantic_name}".`,
    ),
  );

  return true;
}

/**
 * @param {Record<string, unknown>} semantic_mapping
 * @param {string[]} required_semantic_names
 * @param {'semantic role' | 'semantic state'} mapping_label
 * @param {string} file_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {boolean}
 */
function validateRequiredSemanticNames(
  semantic_mapping,
  required_semantic_names,
  mapping_label,
  file_path,
  diagnostics,
) {
  let is_missing_required_name = false;

  for (const required_semantic_name of required_semantic_names) {
    if (Object.hasOwn(semantic_mapping, required_semantic_name)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        file_path,
        `Missing required ${mapping_label} "${required_semantic_name}".`,
      ),
    );
    is_missing_required_name = true;
  }

  return is_missing_required_name;
}

/**
 * @param {string} mapping_label
 * @param {string} semantic_name
 * @returns {string}
 */
function formatSemanticLabel(mapping_label, semantic_name) {
  return `${mapping_label} "${semantic_name}"`;
}

/**
 * @param {string} left_text
 * @param {string} right_text
 * @returns {number}
 */
function compareText(left_text, right_text) {
  return left_text.localeCompare(right_text, 'en');
}
