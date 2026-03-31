/**
 * @typedef {import('./flow/flow-contract.js').FlowBindingTarget} FlowBindingTarget
 * @typedef {import('./flow/flow-contract.js').FlowConsole} FlowConsole
 * @typedef {import('./flow/flow-contract.js').FlowHandlerResult} FlowHandlerResult
 * @typedef {import('./flow/flow-contract.js').TaskFlowState} TaskFlowState
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
 * @template {object} [TAdditional=object]
 * @typedef {import('./flow/flow-contract.js').FlowDefinition<TContext, TApproveData, TAdditional>} FlowDefinition
 */

export { defineFlow } from './flow/flow-contract.js';
export { approve } from './plugins/core/approval.js';
export { flowDispatch } from './plugins/core/flow-dispatch.js';
export { gitMerge } from './plugins/core/git-merge.js';
export { gitRebase } from './plugins/core/git-rebase.js';
export { gitSquash } from './plugins/core/git-squash.js';
export { gitStatus } from './plugins/core/git-status.js';
export { queueHandoff } from './plugins/core/queue-handoff.js';
export { run } from './plugins/core/run.js';
export { runCodex } from './plugins/core/run-codex.js';
export { worktreeHandoff } from './plugins/core/worktree-handoff.js';
export { worktreeMerge } from './plugins/core/worktree-merge.js';
export { worktreeRebase } from './plugins/core/worktree-rebase.js';
export { worktreeSquash } from './plugins/core/worktree-squash.js';
