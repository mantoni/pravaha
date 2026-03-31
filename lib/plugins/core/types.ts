export interface PluginConsole {
  error: (...values: unknown[]) => void;
  info: (...values: unknown[]) => void;
  log: (...values: unknown[]) => void;
  warn: (...values: unknown[]) => void;
}

export interface BindingTarget {
  id: string;
  path: string;
  status: string;
}

export interface DispatchFlowOptions {
  flow: string;
  inputs?: Record<string, unknown>;
  wait?: boolean;
}

export interface QueueWaitState {
  branch_head: string;
  branch_ref: string;
  outcome: 'failure' | 'success' | null;
  ready_ref: string;
  state: 'failed' | 'succeeded' | 'waiting';
}

export interface CorePluginContext<TWith> {
  console: PluginConsole;
  dispatchFlow: (
    options: DispatchFlowOptions,
  ) => Promise<Record<string, unknown>>;
  doc: BindingTarget;
  failRun: (error_message: string) => Promise<never>;
  queueWait?: QueueWaitState;
  repo_directory: string;
  requestApproval: () => Promise<void>;
  requestQueueWait: (queue_wait: QueueWaitState) => Promise<void>;
  run_id: string;
  with: TWith;
  worktree_path: string;
}

export interface ApprovalWith {
  message: string;
  options: string[];
  title: string;
}

export interface FlowDispatchWith {
  flow: string;
  inputs?: Record<string, unknown>;
  wait?: boolean;
}

export interface GitMergeWith {
  head: string;
  message?: string;
}

export interface GitRebaseWith {
  head: string;
}

export interface GitSquashWith {
  head: string;
  message?: string;
}

export interface WorktreeHandoffWith {
  branch?: string;
}

export interface QueueHandoffWith {
  branch: string;
}

export interface WorktreeMergeWith {
  message?: string;
  target: string;
}

export interface WorktreeRebaseWith {
  target: string;
}

export interface WorktreeSquashWith {
  message?: string;
  target: string;
}

export interface RunCodexWith {
  prompt: string;
  reasoning?: 'low' | 'medium' | 'high';
}

export interface RunWith {
  capture?: Array<'stderr' | 'stdout'>;
  command: string;
}
