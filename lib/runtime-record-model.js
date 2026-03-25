/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
export {
  createRuntimeRecord,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordPrompt,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
};

/**
 * @param {{
 *   completed_at?: string,
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at: string,
 *   outcome: 'failure' | 'success' | null,
 *   prompt: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_targets: { failure: string, success: string },
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: import('@openai/codex-sdk').Usage | null,
 *   worktree_path: string,
 * }} options
 * @returns {{
  contract_path: string,
  flow_path: string,
  lease: {leased_at: string},
  local_outcome: {completed_at?: string, state: 'failure' | 'success' | 'unresolved'},
  prompt: string,
  selected_task: {id: string, path: string},
  transition_targets: {failure: string, success: string},
  worker: {
  error_message: string | null,
  final_response: string | null,
  item_count: number,
  thread_id: string | null,
  usage: $12$openai$l$codex$j$sdk.Usage | null
},
  worktree: {path: string}
}}
 *   contract_path: string,
 *   flow_path: string,
 *   lease: { leased_at: string },
 *   local_outcome: { completed_at?: string, state: 'failure' | 'success' | 'unresolved' },
 *   prompt: string,
 *   selected_task: { id: string, path: string },
 *   transition_targets: { failure: string, success: string },
 *   worker: {
 *     error_message: string | null,
 *     final_response: string | null,
 *     item_count: number,
 *     thread_id: string | null,
 *     usage: import('@openai/codex-sdk').Usage | null,
 *   },
 *   worktree: { path: string },
 * }}
 */
function createRuntimeRecord(options) {
  /** @type {{
   *   completed_at?: string,
   *   state: 'failure' | 'success' | 'unresolved',
   * }} */
  const local_outcome = {
    state: options.outcome ?? 'unresolved',
  };

  if (typeof options.completed_at === 'string') {
    local_outcome.completed_at = options.completed_at;
  }

  return {
    contract_path: options.contract_path,
    flow_path: options.flow_path,
    lease: {
      leased_at: options.leased_at,
    },
    local_outcome,
    prompt: options.prompt,
    selected_task: {
      id: options.task_id,
      path: options.task_path,
    },
    transition_targets: options.transition_targets,
    worker: {
      error_message: options.worker_error,
      final_response: options.worker_final_response,
      item_count: options.worker_item_count,
      thread_id: options.worker_thread_id,
      usage: options.worker_usage,
    },
    worktree: {
      path: options.worktree_path,
    },
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordContractPath(runtime_record) {
  if (typeof runtime_record.contract_path === 'string') {
    return runtime_record.contract_path;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordFlowPath(runtime_record) {
  if (typeof runtime_record.flow_path === 'string') {
    return runtime_record.flow_path;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordLeaseTime(runtime_record) {
  const lease_record = runtime_record.lease;

  if (isRecord(lease_record) && typeof lease_record.leased_at === 'string') {
    return lease_record.leased_at;
  }

  if (typeof runtime_record.leased_at === 'string') {
    return runtime_record.leased_at;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string}
 */
function getRuntimeRecordLocalOutcomeState(runtime_record) {
  const local_outcome = runtime_record.local_outcome;

  if (isRecord(local_outcome) && typeof local_outcome.state === 'string') {
    return local_outcome.state;
  }

  if (
    runtime_record.outcome === 'success' ||
    runtime_record.outcome === 'failure'
  ) {
    return runtime_record.outcome;
  }

  return 'unresolved';
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordPrompt(runtime_record) {
  if (typeof runtime_record.prompt === 'string') {
    return runtime_record.prompt;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordSelectedTaskId(runtime_record) {
  const selected_task = runtime_record.selected_task;

  if (isRecord(selected_task) && typeof selected_task.id === 'string') {
    return selected_task.id;
  }

  if (typeof runtime_record.task_id === 'string') {
    return runtime_record.task_id;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordSelectedTaskPath(runtime_record) {
  const selected_task = runtime_record.selected_task;

  if (isRecord(selected_task) && typeof selected_task.path === 'string') {
    return selected_task.path;
  }

  if (typeof runtime_record.task_path === 'string') {
    return runtime_record.task_path;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {{ failure: string, success: string } | null}
 */
function getRuntimeRecordTransitionTargets(runtime_record) {
  const transition_targets = runtime_record.transition_targets;

  if (
    transition_targets === null ||
    typeof transition_targets !== 'object' ||
    !('failure' in transition_targets) ||
    !('success' in transition_targets) ||
    typeof transition_targets.failure !== 'string' ||
    typeof transition_targets.success !== 'string'
  ) {
    return null;
  }

  return {
    failure: transition_targets.failure,
    success: transition_targets.success,
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorkerThreadId(runtime_record) {
  const worker_record = runtime_record.worker;

  if (isRecord(worker_record) && typeof worker_record.thread_id === 'string') {
    return worker_record.thread_id;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorktreePath(runtime_record) {
  const worktree_record = runtime_record.worktree;

  if (isRecord(worktree_record) && typeof worktree_record.path === 'string') {
    return worktree_record.path;
  }

  if (typeof runtime_record.worktree_path === 'string') {
    return runtime_record.worktree_path;
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object';
}
