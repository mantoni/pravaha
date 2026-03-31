export { dispatch, worker } from './lib/runtime/dispatch/session.js';
export { approve as approveRun } from './lib/approve.js';
export {
  approve,
  run,
  runCodex,
  worktreeHandoff,
} from './lib/flow/built-ins.js';
export { definePlugin } from './lib/plugins/plugin-contract.js';
export {
  initQueue,
  pullQueue,
  publishQueue,
  syncQueue,
} from './lib/queue/queue.js';
export { validateRepo } from './lib/repo/validate-repo.js';
export { status } from './lib/runtime/status/status.js';

export interface FlowBindingTarget {
  id: string;
  path: string;
  status: string;
}

export interface FlowConsole {
  error: (...values: unknown[]) => void;
  info: (...values: unknown[]) => void;
  log: (...values: unknown[]) => void;
  warn: (...values: unknown[]) => void;
}

export type TaskFlowState = Record<string, unknown>;

export type TaskFlowContext<
  TState extends TaskFlowState = TaskFlowState,
  TBindings extends object = { doc: FlowBindingTarget },
> = TBindings & {
  bindings: Record<string, FlowBindingTarget | undefined>;
  console: FlowConsole;
  contract_path: string;
  flow_path: string;
  repo_directory: string;
  run_id: string;
  setState: (next_state: TState) => Promise<void>;
  state: TState;
  task_id: string;
  task_path: string;
  worktree_path: string;
};

export type FlowHandlerResult = unknown;

type BivariantFlowHandler<TArgs extends unknown[]> = {
  bivarianceHack: (...args: TArgs) => FlowHandlerResult;
}['bivarianceHack'];

export type FlowMainHandler<
  TContext extends TaskFlowContext = TaskFlowContext,
> = BivariantFlowHandler<[ctx: TContext]>;

export type FlowApproveHandler<
  TContext extends TaskFlowContext = TaskFlowContext,
  TData = unknown,
> = BivariantFlowHandler<[ctx: TContext, data: TData]>;

export type FlowErrorHandler<
  TContext extends TaskFlowContext = TaskFlowContext,
> = BivariantFlowHandler<[ctx: TContext, error: unknown]>;

export type FlowDefinition<
  TContext extends TaskFlowContext = TaskFlowContext,
  TApproveData = unknown,
  TAdditional extends object = object,
> = TAdditional & {
  main: FlowMainHandler<TContext>;
  onApprove?: FlowApproveHandler<TContext, TApproveData>;
  onError?: FlowErrorHandler<TContext>;
};

export declare function defineFlow<
  TApproveData = unknown,
  TAdditional extends object = object,
>(
  flow_definition: FlowDefinition<TaskFlowContext, TApproveData, TAdditional>,
): FlowDefinition<TaskFlowContext, TApproveData, TAdditional>;

export declare function defineFlow<
  TFlow extends {
    main: (...args: never[]) => FlowHandlerResult;
    onApprove?: (...args: never[]) => FlowHandlerResult;
    onError?: (...args: never[]) => FlowHandlerResult;
  } & object,
>(flow_definition: TFlow): TFlow;
