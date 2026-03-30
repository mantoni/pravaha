import {
  createDiagnostic,
  isPlainObject,
} from '../shared/diagnostics/validation-helpers.js';

const LEGACY_FLOW_FIELD_NAMES = ['jobs', 'steps', 'uses', 'next'];
export {
  assertValidJavaScriptFlowDefinition,
  collectJavaScriptFlowDiagnostics,
  collectJavaScriptFlowHandlers,
};

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_path
 * @returns {Record<string, unknown>}
 */
function assertValidJavaScriptFlowDefinition(flow_definition, flow_path) {
  if (!isPlainObject(flow_definition)) {
    throw new Error(
      `JavaScript flow module "${flow_path}" must evaluate to an object.`,
    );
  }

  const diagnostics = collectJavaScriptFlowDiagnostics(
    flow_definition,
    flow_path,
  );

  if (diagnostics.length > 0) {
    throw new Error(diagnostics[0].message);
  }

  return flow_definition;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_file_path
 * @returns {Array<{ file_path: string, message: string }>}
 */
function collectJavaScriptFlowDiagnostics(flow_definition, flow_file_path) {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  if (typeof flow_definition.main !== 'function') {
    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        'JavaScript flow modules must define flow.main as a function.',
      ),
    );
  }

  for (const legacy_field_name of LEGACY_FLOW_FIELD_NAMES) {
    if (!Object.hasOwn(flow_definition, legacy_field_name)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        flow_file_path,
        `Legacy field flow.${legacy_field_name} is no longer supported in JavaScript flow modules.`,
      ),
    );
  }

  return diagnostics;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @returns {Record<string, Function>}
 */
function collectJavaScriptFlowHandlers(flow_definition) {
  /** @type {Record<string, Function>} */
  const handlers = {};

  for (const [field_name, field_value] of Object.entries(flow_definition)) {
    if (typeof field_value !== 'function') {
      continue;
    }

    handlers[field_name] = field_value;
  }

  return handlers;
}
