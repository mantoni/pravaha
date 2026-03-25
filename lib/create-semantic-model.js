/** @import { JsonReadResult, SemanticModel, ValidationDiagnostic } from './validation.types.ts' */

import { createDiagnostic, isPlainObject } from './validation-helpers.js';
import { validateSemanticMapping } from './validate-semantic-mapping.js';

const REQUIRED_SEMANTIC_STATES = ['ready'];

export { createSemanticModel };

/**
 * @param {JsonReadResult} patram_config_result
 * @param {JsonReadResult} pravaha_config_result
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {SemanticModel | null}
 */
function createSemanticModel(
  patram_config_result,
  pravaha_config_result,
  pravaha_config_path,
  diagnostics,
) {
  diagnostics.push(
    ...patram_config_result.diagnostics,
    ...pravaha_config_result.diagnostics,
  );

  const patram_targets = resolvePatramTargets(
    patram_config_result.value,
    pravaha_config_path,
    diagnostics,
  );
  const pravaha_mappings = resolvePravahaMappings(
    pravaha_config_result.value,
    pravaha_config_path,
    diagnostics,
  );

  if (patram_targets === null || pravaha_mappings === null) {
    return null;
  }

  const semantic_role_names = validateSemanticMapping(
    pravaha_mappings.semantic_roles,
    patram_targets.class_names,
    'semantic role',
    pravaha_config_path,
    diagnostics,
  );
  const semantic_state_names = validateSemanticMapping(
    pravaha_mappings.semantic_states,
    patram_targets.status_names,
    'semantic state',
    pravaha_config_path,
    diagnostics,
    REQUIRED_SEMANTIC_STATES,
  );

  if (semantic_role_names === null || semantic_state_names === null) {
    return null;
  }

  return {
    semantic_role_names,
    semantic_state_names,
  };
}

/**
 * @param {unknown} patram_config_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{ class_names: Set<string>, status_names: Set<string> } | null}
 */
function resolvePatramTargets(
  patram_config_value,
  pravaha_config_path,
  diagnostics,
) {
  if (!isPlainObject(patram_config_value)) {
    return null;
  }

  const patram_classes = patram_config_value.classes;
  const status_names = resolveStatusNames(
    patram_config_value.fields,
    pravaha_config_path,
    diagnostics,
  );

  if (!isPlainObject(patram_classes) || status_names === null) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Cannot validate semantic mappings without Patram classes and fields.',
      ),
    );

    return null;
  }

  return {
    class_names: new Set(Object.keys(patram_classes)),
    status_names,
  };
}

/**
 * @param {unknown} patram_fields
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Set<string> | null}
 */
function resolveStatusNames(patram_fields, pravaha_config_path, diagnostics) {
  if (!isPlainObject(patram_fields)) {
    return null;
  }

  const status_field = patram_fields.status;

  if (!isPlainObject(status_field) || !Array.isArray(status_field.values)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Cannot validate semantic states without a Patram status enum.',
      ),
    );

    return null;
  }

  return new Set(status_field.values);
}

/**
 * @param {unknown} pravaha_config_value
 * @param {string} pravaha_config_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {{ semantic_roles: Record<string, unknown>, semantic_states: Record<string, unknown> } | null}
 */
function resolvePravahaMappings(
  pravaha_config_value,
  pravaha_config_path,
  diagnostics,
) {
  if (!isPlainObject(pravaha_config_value)) {
    return null;
  }

  const semantic_roles = pravaha_config_value.semantic_roles;
  const semantic_states = pravaha_config_value.semantic_states;

  if (!isPlainObject(semantic_roles) || !isPlainObject(semantic_states)) {
    diagnostics.push(
      createDiagnostic(
        pravaha_config_path,
        'Pravaha config must define object-valued semantic_roles and semantic_states mappings.',
      ),
    );

    return null;
  }

  return {
    semantic_roles,
    semantic_states,
  };
}
