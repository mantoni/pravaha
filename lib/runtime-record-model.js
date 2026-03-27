/* eslint-disable max-lines */
/**
 * @import { Usage } from '@openai/codex-sdk'
 */

export {
  createRuntimeRecord,
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCompletedAt,
  getRuntimeRecordContractPath,
  getRuntimeRecordCurrentJobName,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordFlowPath,
  getRuntimeRecordJobOutputs,
  getRuntimeRecordJobVisitCounts,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordPrompt,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
  getRuntimeRecordWorkerThreadId,
};

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   completed_at?: string,
 *   contract_path: string,
 *   current_job_name?: string,
 *   flow_path: string,
 *   format_version?: 'state-machine-v2',
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   leased_at: string,
 *   outcome: 'failure' | 'success' | null,
 *   prompt: string,
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named' | 'pooled',
 *   worktree_path: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRuntimeRecord(options) {
  return {
    approval: createApprovalRecord(options.approval),
    binding_targets: createRuntimeBindingTargets(options.binding_targets),
    contract_path: options.contract_path,
    execution: createExecutionRecord(options.run_id),
    flow_path: options.flow_path,
    format_version: options.format_version,
    job_state: createJobStateRecord(
      options.current_job_name,
      options.job_outputs,
      options.job_visit_counts,
    ),
    lease: {
      leased_at: options.leased_at,
    },
    local_outcome: createLocalOutcomeRecord(
      options.outcome,
      options.completed_at,
    ),
    prompt: options.prompt,
    selected_task: {
      id: options.task_id,
      path: options.task_path,
    },
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
 * @returns {Record<string, { id: string, path: string, status: string }> | null}
 */
function getRuntimeRecordBindingTargets(runtime_record) {
  const binding_targets = runtime_record.binding_targets;

  if (!isRecord(binding_targets)) {
    return null;
  }

  /** @type {Record<string, { id: string, path: string, status: string }>} */
  const normalized_targets = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    const normalized_target = readBindingTarget(binding_target);

    if (normalized_target !== null) {
      normalized_targets[binding_name] = normalized_target;
    }
  }

  return Object.keys(normalized_targets).length === 0
    ? null
    : normalized_targets;
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

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordContractPath(runtime_record) {
  return typeof runtime_record.contract_path === 'string'
    ? runtime_record.contract_path
    : null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordCurrentJobName(runtime_record) {
  const job_state = runtime_record.job_state;

  if (isRecord(job_state) && typeof job_state.current_job_name === 'string') {
    return job_state.current_job_name;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordFormatVersion(runtime_record) {
  return typeof runtime_record.format_version === 'string'
    ? runtime_record.format_version
    : null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordFlowPath(runtime_record) {
  return typeof runtime_record.flow_path === 'string'
    ? runtime_record.flow_path
    : null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {Record<string, Record<string, unknown>>}
 */
function getRuntimeRecordJobOutputs(runtime_record) {
  const job_state = runtime_record.job_state;

  if (!isRecord(job_state) || !isRecord(job_state.job_outputs)) {
    return {};
  }

  /** @type {Record<string, Record<string, unknown>>} */
  const normalized_outputs = {};

  for (const [job_name, output_record] of Object.entries(
    job_state.job_outputs,
  )) {
    if (isRecord(output_record)) {
      normalized_outputs[job_name] = output_record;
    }
  }

  return normalized_outputs;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {Record<string, number>}
 */
function getRuntimeRecordJobVisitCounts(runtime_record) {
  const job_state = runtime_record.job_state;

  if (!isRecord(job_state) || !isRecord(job_state.job_visit_counts)) {
    return {};
  }

  /** @type {Record<string, number>} */
  const normalized_counts = {};

  for (const [job_name, visit_count] of Object.entries(
    job_state.job_visit_counts,
  )) {
    if (
      typeof visit_count === 'number' &&
      Number.isInteger(visit_count) &&
      visit_count > 0
    ) {
      normalized_counts[job_name] = visit_count;
    }
  }

  return normalized_counts;
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

  return 'unresolved';
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordPrompt(runtime_record) {
  return typeof runtime_record.prompt === 'string'
    ? runtime_record.prompt
    : null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordRunId(runtime_record) {
  const execution = runtime_record.execution;

  if (isRecord(execution) && typeof execution.run_id === 'string') {
    return execution.run_id;
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

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorktreeIdentity(runtime_record) {
  const worktree = runtime_record.worktree;

  if (isRecord(worktree) && typeof worktree.identity === 'string') {
    return worktree.identity;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {'ephemeral' | 'named' | 'pooled' | null}
 */
function getRuntimeRecordWorktreeMode(runtime_record) {
  const worktree = runtime_record.worktree;

  if (
    isRecord(worktree) &&
    (worktree.mode === 'ephemeral' ||
      worktree.mode === 'named' ||
      worktree.mode === 'pooled')
  ) {
    return worktree.mode;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorktreePath(runtime_record) {
  const worktree = runtime_record.worktree;

  if (isRecord(worktree) && typeof worktree.path === 'string') {
    return worktree.path;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorktreeSlot(runtime_record) {
  const worktree = runtime_record.worktree;

  if (isRecord(worktree) && typeof worktree.slot === 'string') {
    return worktree.slot;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordWorkerThreadId(runtime_record) {
  const worker = runtime_record.worker;

  if (isRecord(worker) && typeof worker.thread_id === 'string') {
    return worker.thread_id;
  }

  if (isRecord(worker) && worker.thread_id === null) {
    return null;
  }

  return null;
}

/**
 * @param {{
 *   approved_at: string | null,
 *   requested_at: string,
 * } | undefined} approval
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
 * @param {Record<string, { id: string, path: string, status: string } | undefined> | undefined} binding_targets
 * @returns {Record<string, { id: string, path: string, status: string }> | undefined}
 */
function createRuntimeBindingTargets(binding_targets) {
  if (binding_targets === undefined) {
    return undefined;
  }

  /** @type {Record<string, { id: string, path: string, status: string }>} */
  const normalized_targets = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    if (binding_target !== undefined) {
      normalized_targets[binding_name] = {
        id: binding_target.id,
        path: binding_target.path,
        status: binding_target.status,
      };
    }
  }

  return normalized_targets;
}

/**
 * @param {string | undefined} run_id
 * @returns {{ run_id?: string }}
 */
function createExecutionRecord(run_id) {
  if (typeof run_id === 'string') {
    return {
      run_id,
    };
  }

  return {};
}

/**
 * @param {string | undefined} current_job_name
 * @param {Record<string, Record<string, unknown>> | undefined} job_outputs
 * @param {Record<string, number> | undefined} job_visit_counts
 * @returns {{ current_job_name?: string, job_outputs?: Record<string, Record<string, unknown>>, job_visit_counts?: Record<string, number> } | undefined}
 */
function createJobStateRecord(current_job_name, job_outputs, job_visit_counts) {
  /** @type {{
   *   current_job_name?: string,
   *   job_outputs?: Record<string, Record<string, unknown>>,
   *   job_visit_counts?: Record<string, number>,
   * }} */
  const job_state = {};

  if (typeof current_job_name === 'string') {
    job_state.current_job_name = current_job_name;
  }

  if (job_outputs !== undefined) {
    job_state.job_outputs = job_outputs;
  }

  if (job_visit_counts !== undefined) {
    job_state.job_visit_counts = job_visit_counts;
  }

  return Object.keys(job_state).length === 0 ? undefined : job_state;
}

/**
 * @param {'failure' | 'success' | null} outcome
 * @param {string | undefined} completed_at
 * @returns {{ completed_at?: string, state: 'failure' | 'success' | 'unresolved' }}
 */
function createLocalOutcomeRecord(outcome, completed_at) {
  /** @type {{ completed_at?: string, state: 'failure' | 'success' | 'unresolved' }} */
  const local_outcome = {
    state: outcome ?? 'unresolved',
  };

  if (typeof completed_at === 'string') {
    local_outcome.completed_at = completed_at;
  }

  return local_outcome;
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
 *   worktree_mode?: 'ephemeral' | 'named' | 'pooled',
 *   worktree_path: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {{
 *   identity?: string,
 *   mode?: 'ephemeral' | 'named' | 'pooled',
 *   path: string,
 *   slot?: string,
 * }}
 */
function createWorktreeRecord(options) {
  /** @type {{
   *   identity?: string,
   *   mode?: 'ephemeral' | 'named' | 'pooled',
   *   path: string,
   *   slot?: string,
   * }} */
  const worktree = {
    path: options.worktree_path,
  };

  if (typeof options.worktree_identity === 'string') {
    worktree.identity = options.worktree_identity;
  }

  if (options.worktree_mode !== undefined) {
    worktree.mode = options.worktree_mode;
  }

  if (typeof options.worktree_slot === 'string') {
    worktree.slot = options.worktree_slot;
  }

  return worktree;
}

/**
 * @param {unknown} binding_target
 * @returns {{ id: string, path: string, status: string } | null}
 */
function readBindingTarget(binding_target) {
  if (!isRecord(binding_target)) {
    return null;
  }

  if (
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
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
