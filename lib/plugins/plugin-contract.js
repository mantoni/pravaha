import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';
import { readRequiredFlowRuntime } from '../flow/runtime.js';

const PLUGIN_CONTRACT_BRAND = Symbol.for('pravaha.plugin_contract');

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/**
 * @template TContext
 * @template TWith
 * @typedef {{
 *   run: (context: TContext) => Promise<unknown> | unknown,
 *   with?: TWith,
 * }} PluginImplementation
 */

/**
 * @template TContext
 * @template TWith
 * @typedef {((ctx: Record<string, unknown>, with_value: unknown) => Promise<unknown>) & PluginImplementation<TContext, TWith>} PluginDefinition
 */

export { definePlugin };

/**
 * @template TContext
 * @template {ZodType | undefined} TWith
 * @param {PluginImplementation<TContext, TWith>} plugin_definition
 * @returns {PluginDefinition<TContext, TWith>}
 */
function definePlugin(plugin_definition) {
  if (!isPlainObject(plugin_definition)) {
    throw new TypeError('Plugin definition must be an object.');
  }

  /**
   * @param {Record<string, unknown>} ctx
   * @param {unknown} with_value
   * @returns {Promise<unknown>}
   */
  const callablePlugin = async (ctx, with_value) => {
    return readRequiredFlowRuntime(ctx).invoke_plugin(
      callablePlugin,
      with_value,
    );
  };

  return Object.freeze(
    Object.assign(callablePlugin, plugin_definition, {
      [PLUGIN_CONTRACT_BRAND]: true,
    }),
  );
}
