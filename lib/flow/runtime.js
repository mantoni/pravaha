export { attachFlowRuntime, readRequiredFlowRuntime };

const FLOW_RUNTIME = Symbol.for('pravaha.flow_runtime');

/**
 * @param {Record<string, unknown>} ctx
 * @param {{
 *   invoke_plugin: (
 *     plugin_definition: Function,
 *     with_value: unknown,
 *   ) => Promise<unknown>,
 * }} flow_runtime
 * @returns {Record<string, unknown>}
 */
function attachFlowRuntime(ctx, flow_runtime) {
  Object.defineProperty(ctx, FLOW_RUNTIME, {
    configurable: false,
    enumerable: false,
    value: flow_runtime,
    writable: false,
  });

  return ctx;
}

/**
 * @param {Record<string, unknown>} ctx
 * @returns {{
 *   invoke_plugin: (
 *     plugin_definition: Function,
 *     with_value: unknown,
 *   ) => Promise<unknown>,
 * }}
 */
function readRequiredFlowRuntime(ctx) {
  const flow_runtime = /** @type {Record<PropertyKey, unknown>} */ (ctx)[
    FLOW_RUNTIME
  ];

  if (
    flow_runtime === null ||
    typeof flow_runtime !== 'object' ||
    typeof (
      /** @type {Record<string, unknown>} */ (flow_runtime).invoke_plugin
    ) !== 'function'
  ) {
    throw new TypeError('Expected a Pravaha flow ctx as the first argument.');
  }

  const validated_flow_runtime = /** @type {{
   *   invoke_plugin: (
   *     plugin_definition: Function,
   *     with_value: unknown,
   *   ) => Promise<unknown>,
   * }} */ (flow_runtime);

  return validated_flow_runtime;
}
