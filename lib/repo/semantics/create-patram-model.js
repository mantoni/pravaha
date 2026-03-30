/** @import { JsonReadResult, PatramModel, ValidationDiagnostic } from '../../shared/types/validation.types.ts' */

import {
  createDiagnostic,
  isPlainObject,
} from '../../shared/diagnostics/validation-helpers.js';

export { createPatramModel };

/**
 * @param {JsonReadResult} patram_config_result
 * @param {string} patram_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {PatramModel | null}
 */
function createPatramModel(
  patram_config_result,
  patram_config_path,
  diagnostics,
) {
  diagnostics.push(...patram_config_result.diagnostics);

  if (!isPlainObject(patram_config_result.value)) {
    return null;
  }

  const class_names = readPatramClassNames(
    patram_config_result.value.classes,
    patram_config_path,
    diagnostics,
  );
  const status_names = readPatramStatusNames(
    patram_config_result.value.fields,
    patram_config_path,
    diagnostics,
  );

  if (class_names === null || status_names === null) {
    return null;
  }

  return {
    class_names,
    status_names,
  };
}

/**
 * @param {unknown} classes_value
 * @param {string} patram_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Set<string> | null}
 */
function readPatramClassNames(classes_value, patram_config_path, diagnostics) {
  if (!isPlainObject(classes_value)) {
    diagnostics.push(
      createDiagnostic(
        patram_config_path,
        'Cannot validate flow triggers without Patram classes.',
      ),
    );

    return null;
  }

  return new Set(
    Object.keys(classes_value).filter(
      (class_name) =>
        class_name !== 'document' && class_name.startsWith('$') === false,
    ),
  );
}

/**
 * @param {unknown} fields_value
 * @param {string} patram_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Set<string> | null}
 */
function readPatramStatusNames(fields_value, patram_config_path, diagnostics) {
  if (!isPlainObject(fields_value) || !isPlainObject(fields_value.status)) {
    diagnostics.push(
      createDiagnostic(
        patram_config_path,
        'Cannot validate flow triggers without a Patram status enum.',
      ),
    );

    return null;
  }

  if (!Array.isArray(fields_value.status.values)) {
    diagnostics.push(
      createDiagnostic(
        patram_config_path,
        'Cannot validate flow triggers without a Patram status enum.',
      ),
    );

    return null;
  }

  return new Set(fields_value.status.values);
}
