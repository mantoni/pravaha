/* eslint-disable max-lines */
/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
export {
  createRuntimeRecord,
  getRuntimeRecordAwaitQuery,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordPrompt,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionConditions,
  getRuntimeRecordTransitionTargetBindings,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
};

/**
 * @param {{
 *   await_query?: string,
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   completed_at?: string,
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at: string,
 *   outcome: 'failure' | 'success' | null,
 *   prompt: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: import('@openai/codex-sdk').Usage | null,
 *   worktree_path: string,
 * }} options
 * @returns {Record<string, unknown>}
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
    await_query:
      options.await_query ??
      '$class == $signal and kind == worker_completed and subject == task',
    binding_targets: options.binding_targets ?? {
      task: {
        id: `task:${options.task_id}`,
        path: options.task_path,
        status: 'ready',
      },
    },
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
    transition_conditions:
      options.transition_conditions ?? createDefaultTransitionConditions(),
    transition_target_bindings:
      options.transition_target_bindings ?? createDefaultTransitionBindings(),
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
function getRuntimeRecordAwaitQuery(runtime_record) {
  if (typeof runtime_record.await_query === 'string') {
    return runtime_record.await_query;
  }

  return '$class == $signal and kind == worker_completed and subject == task';
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * } | null}
 */
function getRuntimeRecordBindingTargets(runtime_record) {
  const binding_targets = runtime_record.binding_targets;

  if (!isRecord(binding_targets)) {
    const task_id = getRuntimeRecordSelectedTaskId(runtime_record);
    const task_path = getRuntimeRecordSelectedTaskPath(runtime_record);

    if (task_id === null || task_path === null) {
      return null;
    }

    return {
      task: {
        id: `task:${task_id}`,
        path: task_path,
        status: 'ready',
      },
    };
  }

  /** @type {{
   *   document?: { id: string, path: string, status: string },
   *   task?: { id: string, path: string, status: string },
   * }} */
  const resolved_targets = {};

  const document_target = readBindingTarget(binding_targets.document);

  if (document_target !== null) {
    resolved_targets.document = document_target;
  }

  const task_target = readBindingTarget(binding_targets.task);

  if (task_target !== null) {
    resolved_targets.task = task_target;
  }

  if (
    resolved_targets.document === undefined &&
    resolved_targets.task === undefined
  ) {
    return null;
  }

  return resolved_targets;
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
function getRuntimeRecordTransitionConditions(runtime_record) {
  const transition_conditions = runtime_record.transition_conditions;

  if (
    transition_conditions === null ||
    typeof transition_conditions !== 'object' ||
    !('failure' in transition_conditions) ||
    !('success' in transition_conditions) ||
    typeof transition_conditions.failure !== 'string' ||
    typeof transition_conditions.success !== 'string'
  ) {
    return createDefaultTransitionConditions();
  }

  return {
    failure: transition_conditions.failure,
    success: transition_conditions.success,
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {{ failure: string, success: string } | null}
 */
function getRuntimeRecordTransitionTargetBindings(runtime_record) {
  const transition_target_bindings = runtime_record.transition_target_bindings;

  if (
    transition_target_bindings === null ||
    typeof transition_target_bindings !== 'object' ||
    !('failure' in transition_target_bindings) ||
    !('success' in transition_target_bindings) ||
    typeof transition_target_bindings.failure !== 'string' ||
    typeof transition_target_bindings.success !== 'string'
  ) {
    return createDefaultTransitionBindings();
  }

  return {
    failure: transition_target_bindings.failure,
    success: transition_target_bindings.success,
  };
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
 * @returns {{ failure: string, success: string }}
 */
function createDefaultTransitionConditions() {
  return {
    failure:
      '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
    success:
      '$class == $signal and kind == worker_completed and subject == task and outcome == success',
  };
}

/**
 * @returns {{ failure: string, success: string }}
 */
function createDefaultTransitionBindings() {
  return {
    failure: 'task',
    success: 'task',
  };
}

/**
 * @param {unknown} binding_target
 * @returns {{ id: string, path: string, status: string } | null}
 */
function readBindingTarget(binding_target) {
  if (
    !isRecord(binding_target) ||
    typeof binding_target.id !== 'string' ||
    typeof binding_target.path !== 'string' ||
    typeof binding_target.status !== 'string'
  ) {
    return null;
  }

  return {
    id: binding_target.id,
    path: binding_target.path,
    status: binding_target.status,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object';
}
