import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

const FLOW_CONTRACT_BRAND = Symbol.for('pravaha.flow_contract');

export { assertValidFlow, defineFlow };

/**
 * @param {Record<string, unknown>} flow_definition
 * @returns {Record<string, unknown>}
 */
function defineFlow(flow_definition) {
  if (!isPlainObject(flow_definition)) {
    throw new TypeError('Flow definition must be an object.');
  }

  return Object.freeze({
    ...flow_definition,
    [FLOW_CONTRACT_BRAND]: true,
  });
}

/**
 * @param {unknown} flow_value
 * @param {string} flow_path
 * @returns {Record<string, unknown>}
 */
function assertValidFlow(flow_value, flow_path) {
  const branded_flow = /** @type {Record<PropertyKey, unknown> | null} */ (
    isPlainObject(flow_value) ? flow_value : null
  );

  if (branded_flow?.[FLOW_CONTRACT_BRAND] !== true) {
    throw new Error(
      `Flow module "${flow_path}" must default-export defineFlow(...).`,
    );
  }

  return /** @type {Record<string, unknown>} */ (branded_flow);
}
