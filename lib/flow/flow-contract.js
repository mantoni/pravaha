import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

const FLOW_CONTRACT_BRAND = Symbol.for('pravaha.flow_contract');

/**
 * @typedef {object} FlowBindingTarget
 * @property {string} id
 * @property {string} path
 * @property {string} status
 */

/**
 * @typedef {object} FlowConsole
 * @property {(...values: unknown[]) => void} error
 * @property {(...values: unknown[]) => void} info
 * @property {(...values: unknown[]) => void} log
 * @property {(...values: unknown[]) => void} warn
 */

/**
 * @typedef {Record<string, unknown>} TaskFlowState
 */

/**
 * @template {TaskFlowState} [TState=TaskFlowState]
 * @template {object} [TBindings={ doc: FlowBindingTarget }]
 * @typedef {TBindings & {
 *   bindings: Record<string, FlowBindingTarget | undefined>,
 *   console: FlowConsole,
 *   contract_path: string,
 *   flow_path: string,
 *   repo_directory: string,
 *   run_id: string,
 *   setState: (next_state: TState) => Promise<void>,
 *   state: TState,
 *   task_id: string,
 *   task_path: string,
 *   worktree_path: string,
 * }} TaskFlowContext
 */

/**
 * @typedef {unknown} FlowHandlerResult
 */

/**
 * @typedef {{ patram: string }} FlowTriggerDefinition
 */

/**
 * @template {unknown[]} TArgs
 * @typedef {{ bivarianceHack: (...args: TArgs) => FlowHandlerResult }['bivarianceHack']} BivariantFlowHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @typedef {BivariantFlowHandler<[TContext]>} FlowMainHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @template [TData=unknown]
 * @typedef {BivariantFlowHandler<[TContext, TData]>} FlowApproveHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @typedef {BivariantFlowHandler<[TContext, unknown]>} FlowErrorHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @template [TApproveData=unknown]
 * @typedef {{
 *   on: FlowTriggerDefinition,
 *   workspace: string,
 *   main: FlowMainHandler<TContext>,
 *   onApprove?: FlowApproveHandler<TContext, TApproveData>,
 *   onError?: FlowErrorHandler<TContext>,
 * }} FlowDefinition
 */

export { assertValidFlow, defineFlow };

/**
 * @template [TContext=TaskFlowContext]
 * @template [TApproveData=unknown]
 * @param {FlowDefinition<TContext, TApproveData>} flow_definition
 * @returns {FlowDefinition<TContext, TApproveData>}
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
