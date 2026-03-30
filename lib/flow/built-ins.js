export { approve, attachFlowRuntime, run, runCodex };

const FLOW_RUNTIME = Symbol.for('pravaha.flow_runtime');

/**
 * @param {Record<string, unknown>} ctx
 * @param {{
 *   approve: (with_value: Record<string, unknown>) => Promise<never>,
 *   run: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *   run_codex: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
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
 * @param {Record<string, unknown>} with_value
 * @returns {Promise<Record<string, unknown>>}
 */
async function run(ctx, with_value) {
  return readRequiredFlowRuntime(ctx).run(with_value);
}

/**
 * @param {Record<string, unknown>} ctx
 * @param {Record<string, unknown>} with_value
 * @returns {Promise<Record<string, unknown>>}
 */
async function runCodex(ctx, with_value) {
  return readRequiredFlowRuntime(ctx).run_codex(with_value);
}

/**
 * @param {Record<string, unknown>} ctx
 * @param {Record<string, unknown>} with_value
 * @returns {Promise<never>}
 */
async function approve(ctx, with_value) {
  return readRequiredFlowRuntime(ctx).approve(with_value);
}

/**
 * @param {Record<string, unknown>} ctx
 * @returns {{
 *   approve: (with_value: Record<string, unknown>) => Promise<never>,
 *   run: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *   run_codex: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
 * }}
 */
function readRequiredFlowRuntime(ctx) {
  const flow_runtime = /** @type {Record<PropertyKey, unknown>} */ (ctx)[
    FLOW_RUNTIME
  ];

  if (
    flow_runtime === null ||
    typeof flow_runtime !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (flow_runtime).run) !==
      'function' ||
    typeof (/** @type {Record<string, unknown>} */ (flow_runtime).run_codex) !==
      'function' ||
    typeof (/** @type {Record<string, unknown>} */ (flow_runtime).approve) !==
      'function'
  ) {
    throw new TypeError('Expected a Pravaha flow ctx as the first argument.');
  }

  const validated_runtime = /** @type {{
   *   approve: (with_value: Record<string, unknown>) => Promise<never>,
   *   run: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
   *   run_codex: (with_value: Record<string, unknown>) => Promise<Record<string, unknown>>,
   * }} */ (flow_runtime);

  return validated_runtime;
}
