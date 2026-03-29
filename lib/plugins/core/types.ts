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

export interface CorePluginContext<TWith> {
  console: PluginConsole;
  dispatchFlow: (
    options: DispatchFlowOptions,
  ) => Promise<Record<string, unknown>>;
  document?: BindingTarget;
  repo_directory: string;
  requestApproval: () => Promise<void>;
  run_id: string;
  task: BindingTarget;
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

export interface RunCodexWith {
  prompt: string;
  reasoning?: 'low' | 'medium' | 'high';
}

export interface RunWith {
  capture?: Array<'stderr' | 'stdout'>;
  command: string;
}
