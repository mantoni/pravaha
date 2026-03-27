/* eslint-disable max-lines */
/**
 * @import { Usage } from '@openai/codex-sdk';
 */
import { basename } from 'node:path';

export {
  createRuntimeRecord,
  getRuntimeRecordApproval,
  getRuntimeRecordAwaitQuery,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCompletedAt,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordNextStepIndex,
  getRuntimeRecordOrderedSteps,
  getRuntimeRecordPrompt,
  getRuntimeRecordRunId,
  getRuntimeRecordSignals,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionConditions,
  getRuntimeRecordTransitionTargetBindings,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreeSlot,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
};

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   await_query?: string,
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   completed_at?: string,
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at: string,
 *   next_step_index?: number,
 *   outcome: 'failure' | 'success' | null,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   prompt: string,
 *   run_id?: string,
 *   signals?: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named',
 *   worktree_path: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRuntimeRecord(options) {
  const ordered_steps = options.ordered_steps ?? createDefaultOrderedSteps();

  return {
    approval: createApprovalRecord(options.approval),
    await_query:
      options.await_query ??
      '$class == $signal and kind == worker_completed and subject == task',
    binding_targets: createRuntimeBindingTargets(options),
    contract_path: options.contract_path,
    execution: createExecutionRecord(options, ordered_steps),
    flow_path: options.flow_path,
    lease: {
      leased_at: options.leased_at,
    },
    local_outcome: createLocalOutcomeRecord(options),
    prompt: options.prompt,
    selected_task: {
      id: options.task_id,
      path: options.task_path,
    },
    signals: options.signals ?? [],
    steps: ordered_steps,
    transition_conditions:
      options.transition_conditions ?? createDefaultTransitionConditions(),
    transition_target_bindings:
      options.transition_target_bindings ?? createDefaultTransitionBindings(),
    transition_targets: options.transition_targets,
    worker: createWorkerRecord(options),
    worktree: createWorktreeRecord(options),
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {{ approved_at: string | null, requested_at: string } | null}
 */
function getRuntimeRecordApproval(runtime_record) {
  const approval_record = runtime_record.approval;

  if (!isRecord(approval_record)) {
    return null;
  }

  if (typeof approval_record.requested_at !== 'string') {
    return null;
  }

  if (
    approval_record.approved_at !== null &&
    typeof approval_record.approved_at !== 'string'
  ) {
    return null;
  }

  return {
    approved_at: approval_record.approved_at,
    requested_at: approval_record.requested_at,
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
 * @returns {Record<string, { id: string, path: string, status: string }> | null}
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

  /** @type {Record<string, { id: string, path: string, status: string }>} */
  const resolved_targets = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    const resolved_target = readBindingTarget(binding_target);

    if (resolved_target !== null) {
      resolved_targets[binding_name] = resolved_target;
    }
  }

  if (Object.keys(resolved_targets).length === 0) {
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
function getRuntimeRecordCompletedAt(runtime_record) {
  const local_outcome = runtime_record.local_outcome;

  if (
    isRecord(local_outcome) &&
    typeof local_outcome.completed_at === 'string'
  ) {
    return local_outcome.completed_at;
  }

  if (typeof runtime_record.completed_at === 'string') {
    return runtime_record.completed_at;
  }

  return null;
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
 * @returns {number}
 */
function getRuntimeRecordNextStepIndex(runtime_record) {
  const execution_record = runtime_record.execution;
  const next_step_index = isRecord(execution_record)
    ? execution_record.next_step_index
    : null;

  if (
    typeof next_step_index === 'number' &&
    Number.isInteger(next_step_index) &&
    next_step_index >= 0
  ) {
    return next_step_index;
  }

  if (getRuntimeRecordLocalOutcomeState(runtime_record) !== 'unresolved') {
    return getRuntimeRecordOrderedSteps(runtime_record).length;
  }

  return findWorkerStepIndex(getRuntimeRecordOrderedSteps(runtime_record));
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordRunId(runtime_record) {
  const execution_record = runtime_record.execution;

  if (
    isRecord(execution_record) &&
    typeof execution_record.run_id === 'string'
  ) {
    return execution_record.run_id;
  }

  const task_id = getRuntimeRecordSelectedTaskId(runtime_record);
  const leased_at = getRuntimeRecordLeaseTime(runtime_record);

  if (typeof task_id === 'string' && typeof leased_at === 'string') {
    return createDerivedRunId(task_id, leased_at);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >}
 */
function getRuntimeRecordOrderedSteps(runtime_record) {
  if (!Array.isArray(runtime_record.steps)) {
    return createDefaultOrderedSteps();
  }

  const ordered_steps = runtime_record.steps
    .map((step) => normalizeExecutableStep(step))
    .filter((step) => step !== null);

  if (ordered_steps.length === 0) {
    return createDefaultOrderedSteps();
  }

  return ordered_steps;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * }>}
 */
function getRuntimeRecordSignals(runtime_record) {
  if (!Array.isArray(runtime_record.signals)) {
    return [];
  }

  return runtime_record.signals
    .map((signal_record) => normalizeRuntimeSignal(signal_record))
    .filter((signal_record) => signal_record !== null);
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
function getRuntimeRecordWorktreeIdentity(runtime_record) {
  const worktree_record = runtime_record.worktree;

  if (
    isRecord(worktree_record) &&
    typeof worktree_record.identity === 'string'
  ) {
    return worktree_record.identity;
  }

  if (typeof runtime_record.worktree_identity === 'string') {
    return runtime_record.worktree_identity;
  }

  const worktree_slot = getRuntimeRecordWorktreeSlot(runtime_record);

  if (typeof worktree_slot === 'string') {
    return worktree_slot;
  }

  const worktree_path = getRuntimeRecordWorktreePath(runtime_record);

  if (typeof worktree_path === 'string') {
    return basename(worktree_path);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {'ephemeral' | 'named' | null}
 */
function getRuntimeRecordWorktreeMode(runtime_record) {
  const worktree_record = runtime_record.worktree;

  if (
    isRecord(worktree_record) &&
    (worktree_record.mode === 'ephemeral' || worktree_record.mode === 'named')
  ) {
    return worktree_record.mode;
  }

  if (
    runtime_record.worktree_mode === 'ephemeral' ||
    runtime_record.worktree_mode === 'named'
  ) {
    return runtime_record.worktree_mode;
  }

  if (getRuntimeRecordWorktreePath(runtime_record) !== null) {
    return 'named';
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
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorktreeSlot(runtime_record) {
  const worktree_record = runtime_record.worktree;

  if (isRecord(worktree_record) && typeof worktree_record.slot === 'string') {
    return worktree_record.slot;
  }

  if (typeof runtime_record.worktree_slot === 'string') {
    return runtime_record.worktree_slot;
  }

  if (getRuntimeRecordWorktreeMode(runtime_record) === 'named') {
    const worktree_path = getRuntimeRecordWorktreePath(runtime_record);

    if (typeof worktree_path === 'string') {
      return basename(worktree_path);
    }
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
 * @param {{
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   task_id: string,
 *   task_path: string,
 * }} options
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function createRuntimeBindingTargets(options) {
  if (options.binding_targets !== undefined) {
    /** @type {Record<string, { id: string, path: string, status: string }>} */
    const binding_targets = {};

    for (const [binding_name, binding_target] of Object.entries(
      options.binding_targets,
    )) {
      if (binding_target !== undefined) {
        binding_targets[binding_name] = binding_target;
      }
    }

    return binding_targets;
  }

  return {
    task: {
      id: `task:${options.task_id}`,
      path: options.task_path,
      status: 'ready',
    },
  };
}

/**
 * @param {{ approved_at: string | null, requested_at: string } | undefined} approval
 * @returns {{ approved_at: string | null, requested_at: string } | undefined}
 */
function createApprovalRecord(approval) {
  if (approval === undefined) {
    return undefined;
  }

  return {
    approved_at: approval.approved_at,
    requested_at: approval.requested_at,
  };
}

/**
 * @param {{
 *   completed_at?: string,
 *   outcome: 'failure' | 'success' | null,
 * }} options
 * @returns {{
 *   completed_at?: string,
 *   state: 'failure' | 'success' | 'unresolved',
 * }}
 */
function createLocalOutcomeRecord(options) {
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

  return local_outcome;
}

/**
 * @param {{
 *   next_step_index?: number,
 *   outcome: 'failure' | 'success' | null,
 *   run_id?: string,
 * }} options
 * @param {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >} ordered_steps
 * @returns {{ next_step_index: number, run_id?: string }}
 */
function createExecutionRecord(options, ordered_steps) {
  /** @type {{ next_step_index: number, run_id?: string }} */
  const execution_record = {
    next_step_index:
      typeof options.next_step_index === 'number'
        ? options.next_step_index
        : options.outcome !== null
          ? ordered_steps.length
          : findWorkerStepIndex(ordered_steps),
  };

  if (typeof options.run_id === 'string') {
    execution_record.run_id = options.run_id;
  }

  return execution_record;
}

/**
 * @param {{
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }} options
 * @returns {{
 *   error_message: string | null,
 *   final_response: string | null,
 *   item_count: number,
 *   thread_id: string | null,
 *   usage: Usage | null,
 * }}
 */
function createWorkerRecord(options) {
  return {
    error_message: options.worker_error,
    final_response: options.worker_final_response,
    item_count: options.worker_item_count,
    thread_id: options.worker_thread_id,
    usage: options.worker_usage,
  };
}

/**
 * @param {{
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named',
 *   worktree_path: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named',
 *   path: string,
 *   slot: string | undefined,
 * }}
 */
function createWorktreeRecord(options) {
  return {
    identity: options.worktree_identity ?? basename(options.worktree_path),
    mode: options.worktree_mode ?? 'named',
    path: options.worktree_path,
    slot: options.worktree_slot,
  };
}

/**
 * @returns {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >}
 */
function createDefaultOrderedSteps() {
  return [
    {
      kind: 'uses',
      step_name: 'core/codex-sdk',
    },
  ];
}

/**
 * @param {string} task_id
 * @param {string} leased_at
 * @returns {string}
 */
function createDerivedRunId(task_id, leased_at) {
  return `run:${task_id}:${leased_at}`;
}

/**
 * @param {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >} ordered_steps
 * @returns {number}
 */
function findWorkerStepIndex(ordered_steps) {
  const worker_step_index = ordered_steps.findIndex(
    (step) => step.kind === 'uses' && step.step_name === 'core/codex-sdk',
  );

  if (worker_step_index >= 0) {
    return worker_step_index;
  }

  return ordered_steps.length;
}

/**
 * @param {unknown} step
 * @returns {
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 *   | null
 * }
 */
function normalizeExecutableStep(step) {
  if (!isRecord(step)) {
    return null;
  }

  if (step.kind === 'run' && typeof step.command_text === 'string') {
    return {
      command_text: step.command_text,
      kind: 'run',
    };
  }

  if (step.kind === 'uses' && typeof step.step_name === 'string') {
    /** @type {{ kind: 'uses', step_name: string, with_value?: unknown }} */
    const uses_step = {
      kind: 'uses',
      step_name: step.step_name,
    };

    if (Object.hasOwn(step, 'with_value')) {
      uses_step.with_value = step.with_value;
    }

    return uses_step;
  }

  return null;
}

/**
 * @param {unknown} signal_record
 * @returns {{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * } | null}
 */
function normalizeRuntimeSignal(signal_record) {
  if (
    !isRecord(signal_record) ||
    typeof signal_record.emitted_at !== 'string' ||
    typeof signal_record.kind !== 'string' ||
    !isRecord(signal_record.payload) ||
    (signal_record.subject !== 'document' && signal_record.subject !== 'task')
  ) {
    return null;
  }

  /** @type {{
   *   emitted_at: string,
   *   kind: string,
   *   payload: Record<string, unknown>,
   *   run_id?: string,
   *   subject: 'document' | 'task',
   * }} */
  const runtime_signal = {
    emitted_at: signal_record.emitted_at,
    kind: signal_record.kind,
    payload: signal_record.payload,
    subject: signal_record.subject,
  };

  if (typeof signal_record.run_id === 'string') {
    runtime_signal.run_id = signal_record.run_id;
  }

  return runtime_signal;
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
