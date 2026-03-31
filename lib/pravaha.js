/**
 * @typedef {import('./flow/flow-contract.js').FlowBindingTarget} FlowBindingTarget
 * @typedef {import('./flow/flow-contract.js').FlowConsole} FlowConsole
 * @typedef {import('./flow/flow-contract.js').FlowHandlerResult} FlowHandlerResult
 * @typedef {import('./flow/flow-contract.js').FlowTriggerDefinition} FlowTriggerDefinition
 * @typedef {import('./flow/flow-contract.js').TaskFlowState} TaskFlowState
 * @typedef {import('./plugins/plugin-contract.js').DispatchFlowOptions} DispatchFlowOptions
 * @typedef {import('./plugins/plugin-contract.js').QueueWaitState} QueueWaitState
 */

/**
 * @template {TaskFlowState} [TState=TaskFlowState]
 * @template {object} [TBindings={ doc: FlowBindingTarget }]
 * @typedef {import('./flow/flow-contract.js').TaskFlowContext<TState, TBindings>} TaskFlowContext
 */

/**
 * @template [TContext=TaskFlowContext]
 * @typedef {import('./flow/flow-contract.js').FlowMainHandler<TContext>} FlowMainHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @template [TData=unknown]
 * @typedef {import('./flow/flow-contract.js').FlowApproveHandler<TContext, TData>} FlowApproveHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @typedef {import('./flow/flow-contract.js').FlowErrorHandler<TContext>} FlowErrorHandler
 */

/**
 * @template [TContext=TaskFlowContext]
 * @template [TApproveData=unknown]
 * @typedef {import('./flow/flow-contract.js').FlowDefinition<TContext, TApproveData>} FlowDefinition
 */

/**
 * @template [TWith=unknown]
 * @template {object} [TBindings={ doc: FlowBindingTarget }]
 * @typedef {import('./plugins/plugin-contract.js').PluginContext<TWith, TBindings>} PluginContext
 */

/**
 * @template [TWith=unknown]
 * @template [TResult=unknown]
 * @template [TRunContext=import('./plugins/plugin-contract.js').PluginContext<TWith, { doc: FlowBindingTarget }>]
 * @typedef {import('./plugins/plugin-contract.js').CallablePlugin<TWith, TResult, TRunContext>} CallablePlugin
 */

export { dispatch } from './runtime/dispatch/session.js';
export { approve as approveRun } from './approve.js';
export { defineConfig } from './config/config-contract.js';
export { defineFlow } from './flow/flow-contract.js';
export { definePlugin } from './plugins/plugin-contract.js';
export {
  initQueue,
  pullQueue,
  publishQueue,
  syncQueue,
} from './queue/queue.js';
export { validateRepo } from './repo/validate-repo.js';
export { status } from './runtime/status/status.js';
export { worker } from './runtime/dispatch/session.js';
