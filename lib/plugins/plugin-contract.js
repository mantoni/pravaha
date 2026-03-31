import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';
import { readRequiredFlowRuntime } from '../flow/runtime.js';

const PLUGIN_CONTRACT_BRAND = Symbol.for('pravaha.plugin_contract');

/**
 * @typedef {import('../flow/flow-contract.js').FlowBindingTarget} FlowBindingTarget
 */

/**
 * @typedef {import('../flow/flow-contract.js').FlowConsole} FlowConsole
 */

/**
 * @typedef {import('../flow/flow-contract.js').TaskFlowContext} TaskFlowContext
 */

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/**
 * @typedef {object} DispatchFlowOptions
 * @property {string} flow
 * @property {Record<string, unknown>} [inputs]
 * @property {boolean} [wait]
 */

/**
 * @typedef {object} QueueWaitState
 * @property {string} branch_head
 * @property {string} branch_ref
 * @property {'failure' | 'success' | null} outcome
 * @property {string} ready_ref
 * @property {'failed' | 'succeeded' | 'waiting'} state
 */

/**
 * @template [TWith=unknown]
 * @template {object} [TBindings={ doc: FlowBindingTarget }]
 * @typedef {TBindings & {
 *   console: FlowConsole,
 *   dispatchFlow: (options: DispatchFlowOptions) => Promise<Record<string, unknown>>,
 *   failRun: (error_message: string) => Promise<never>,
 *   queueWait?: QueueWaitState,
 *   repo_directory: string,
 *   requestApproval: () => Promise<void>,
 *   requestQueueWait: (queue_wait: QueueWaitState) => Promise<void>,
 *   run_id: string,
 *   with: TWith,
 *   worktree_path: string,
 * }} PluginContext
 */

/**
 * @template TContext
 * @template TWith
 * @template TResult
 * @typedef {{
 *   run: (context: TContext) => Promise<TResult> | TResult,
 *   with?: TWith,
 * }} PluginImplementation
 */

/**
 * @template TContext
 * @template TWith
 * @template TResult
 * @typedef {{
 *   (ctx: TaskFlowContext, with_value: TWith): Promise<TResult>;
 *   run: (context: TContext) => Promise<TResult> | TResult;
 *   with?: unknown;
 * }} PluginDefinition
 */

/**
 * @template [TWith=unknown]
 * @template [TResult=unknown]
 * @template [TRunContext=PluginContext<TWith>]
 * @typedef {{
 *   (ctx: TaskFlowContext, with_value: TWith): Promise<TResult>;
 *   run: (context: TRunContext) => Promise<TResult> | TResult;
 *   with?: unknown;
 * }} CallablePlugin
 */

export { definePlugin };

/**
 * @template TContext
 * @template {ZodType | undefined} TWith
 * @template [TResult=unknown]
 * @param {PluginImplementation<TContext, TWith, TResult>} plugin_definition
 * @returns {CallablePlugin<unknown, TResult, TContext> & {
 *   run: (context: TContext) => Promise<TResult> | TResult,
 * }}
 */
function definePlugin(plugin_definition) {
  if (!isPlainObject(plugin_definition)) {
    throw new TypeError('Plugin definition must be an object.');
  }

  /**
   * @param {TaskFlowContext} ctx
   * @param {unknown} with_value
   * @returns {Promise<TResult>}
   */
  const callablePlugin = async (ctx, with_value) => {
    return /** @type {Promise<TResult>} */ (
      readRequiredFlowRuntime(ctx).invoke_plugin(callablePlugin, with_value)
    );
  };

  return Object.freeze(
    Object.assign(callablePlugin, plugin_definition, {
      [PLUGIN_CONTRACT_BRAND]: true,
    }),
  );
}
