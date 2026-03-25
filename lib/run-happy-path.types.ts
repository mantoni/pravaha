import type {
  RunResult,
  ThreadOptions,
  TurnOptions,
  Usage,
} from '@openai/codex-sdk';

export type HappyPathWorkerClient = {
  startThread: (thread_options?: ThreadOptions) => {
    id: string | null;
    run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>;
  };
};

export type HappyPathWorkerResult = {
  outcome: 'success' | 'failure';
  worker_error: string | null;
  worker_final_response: string | null;
  worker_item_count: number;
  worker_thread_id: string | null;
  worker_usage: Usage | null;
};

export type HappyPathRunResult = {
  contract_path: string;
  outcome: 'success' | 'failure';
  prompt: string;
  root_flow_path: string;
  runtime_record_path: string;
  task_id: string;
  task_path: string;
  worker_error: string | null;
  worker_final_response: string | null;
  worker_thread_id: string | null;
  worktree_path: string;
};

export type ReadyTask = {
  task_id: string;
  task_path: string;
};

export type ActiveContract = {
  contract_path: string;
  root_flow_path: string;
};

export type RunContext = {
  active_contract: ActiveContract;
  prompt: string;
  ready_task: ReadyTask;
  runtime_record_path: string;
  started_at: string;
  worktree_path: string;
};

export type RuntimeRecordOptions = {
  completed_at?: string;
  contract_path: string;
  flow_path: string;
  leased_at: string;
  outcome: 'success' | 'failure' | null;
  prompt: string;
  task_id: string;
  task_path: string;
  worker_error: string | null;
  worker_final_response: string | null;
  worker_item_count: number;
  worker_thread_id: string | null;
  worker_usage: Usage | null;
  worktree_path: string;
};

export type RuntimeRecord = {
  completed_at?: string;
  contract_path: string;
  flow_path: string;
  leased_at: string;
  outcome: 'success' | 'failure' | null;
  prompt: string;
  task_id: string;
  task_path: string;
  worker: {
    error_message: string | null;
    final_response: string | null;
    item_count: number;
    thread_id: string | null;
    usage: Usage | null;
  };
  worktree_path: string;
};
