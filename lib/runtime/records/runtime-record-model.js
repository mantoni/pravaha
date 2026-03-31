/* eslint-disable max-lines */

export {
  createRuntimeRecord,
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCompletedAt,
  getRuntimeRecordContractPath,
  getRuntimeRecordCurrentHandlerName,
  getRuntimeRecordFlowInstanceId,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordFlowPath,
  getRuntimeRecordFlowState,
  getRuntimeRecordFlowWaitState,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordQueueWait,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
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
 *   current_handler_name?: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state?: Record<string, unknown>,
 *   format_version?: 'javascript-flow-v1',
 *   outcome: 'failure' | 'success' | null,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error?: string | null,
 *   worker_final_response?: string | null,
 *   worker_item_count?: number,
 *   worker_thread_id?: string | null,
 *   worker_usage?: null,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named' | 'pooled',
 *   worktree_path?: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRuntimeRecord(options) {
  /** @type {Record<string, unknown>} */
  const runtime_record = {
    approval: createApprovalRecord(options.approval),
    binding_targets: createRuntimeBindingTargets(options.binding_targets),
    contract_path: options.contract_path,
    execution: createExecutionRecord(options.run_id),
    flow_instance_id: options.flow_instance_id ?? options.task_id,
    flow_path: options.flow_path,
    flow_state: createFlowStateRecord(
      options.current_handler_name,
      options.flow_state,
      options.wait_state,
    ),
    format_version: options.format_version,
    local_outcome: createLocalOutcomeRecord(
      options.outcome,
      options.completed_at,
    ),
    queue_wait: createQueueWaitRecord(options.queue_wait),
    selected_task: {
      id: options.task_id,
      path: options.task_path,
    },
  };

  const worktree_record = createWorktreeRecord(options);

  if (worktree_record !== undefined) {
    runtime_record.worktree = worktree_record;
  }

  return runtime_record;
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
function getRuntimeRecordCurrentHandlerName(runtime_record) {
  const flow_state = runtime_record.flow_state;

  if (
    isRecord(flow_state) &&
    typeof flow_state.current_handler_name === 'string'
  ) {
    return flow_state.current_handler_name;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function getRuntimeRecordFlowInstanceId(runtime_record) {
  return typeof runtime_record.flow_instance_id === 'string'
    ? runtime_record.flow_instance_id
    : null;
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
 * @returns {Record<string, unknown>}
 */
function getRuntimeRecordFlowState(runtime_record) {
  const flow_state = runtime_record.flow_state;

  if (!isRecord(flow_state) || !isRecord(flow_state.durable_state)) {
    return {};
  }

  return flow_state.durable_state;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {{
 *   data?: unknown,
 *   handler_name: string,
 *   kind: 'approval',
 * } | null}
 */
function getRuntimeRecordFlowWaitState(runtime_record) {
  const flow_state = runtime_record.flow_state;

  if (!isRecord(flow_state) || !isRecord(flow_state.wait_state)) {
    return null;
  }

  const wait_state = flow_state.wait_state;

  if (
    wait_state.kind !== 'approval' ||
    typeof wait_state.handler_name !== 'string'
  ) {
    return null;
  }

  /** @type {{
   *   data?: unknown,
   *   handler_name: string,
   *   kind: 'approval',
   * }} */
  const normalized_wait_state = {
    handler_name: wait_state.handler_name,
    kind: 'approval',
  };

  if ('data' in wait_state) {
    normalized_wait_state.data = wait_state.data;
  }

  return normalized_wait_state;
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
 * @returns {{
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * } | null}
 */
function getRuntimeRecordQueueWait(runtime_record) {
  const queue_wait = runtime_record.queue_wait;

  if (!isRecord(queue_wait)) {
    return null;
  }

  if (
    typeof queue_wait.branch_head !== 'string' ||
    typeof queue_wait.branch_ref !== 'string' ||
    typeof queue_wait.ready_ref !== 'string' ||
    !isQueueWaitState(queue_wait.state)
  ) {
    return null;
  }

  if (
    queue_wait.outcome !== null &&
    queue_wait.outcome !== 'failure' &&
    queue_wait.outcome !== 'success'
  ) {
    return null;
  }

  return {
    branch_head: queue_wait.branch_head,
    branch_ref: queue_wait.branch_ref,
    outcome: queue_wait.outcome,
    ready_ref: queue_wait.ready_ref,
    state: queue_wait.state,
  };
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
 * @param {string | undefined} current_handler_name
 * @param {Record<string, unknown> | undefined} flow_state
 * @param {{
 *   data?: unknown,
 *   handler_name: string,
 *   kind: 'approval',
 * } | undefined} wait_state
 * @returns {{
 *   current_handler_name?: string,
 *   durable_state?: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * } | undefined}
 */
function createFlowStateRecord(current_handler_name, flow_state, wait_state) {
  /** @type {{
   *   current_handler_name?: string,
   *   durable_state?: Record<string, unknown>,
   *   wait_state?: {
   *     data?: unknown,
   *     handler_name: string,
   *     kind: 'approval',
   *   },
   * }} */
  const flow_state_record = {};

  if (typeof current_handler_name === 'string') {
    flow_state_record.current_handler_name = current_handler_name;
  }

  if (flow_state !== undefined) {
    flow_state_record.durable_state = flow_state;
  }

  if (wait_state !== undefined) {
    flow_state_record.wait_state = createWaitStateRecord(wait_state);
  }

  return Object.keys(flow_state_record).length === 0
    ? undefined
    : flow_state_record;
}

/**
 * @param {{
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named' | 'pooled',
 *   worktree_path?: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named' | 'pooled',
 *   path: string,
 *   slot?: string,
 * } | undefined}
 */
function createWorktreeRecord(options) {
  if (
    typeof options.worktree_identity !== 'string' ||
    (options.worktree_mode !== 'ephemeral' &&
      options.worktree_mode !== 'named' &&
      options.worktree_mode !== 'pooled') ||
    typeof options.worktree_path !== 'string'
  ) {
    return undefined;
  }

  /** @type {{
   *   identity: string,
   *   mode: 'ephemeral' | 'named' | 'pooled',
   *   path: string,
   *   slot?: string,
   * }} */
  const worktree_record = {
    identity: options.worktree_identity,
    mode: options.worktree_mode,
    path: options.worktree_path,
  };

  if (typeof options.worktree_slot === 'string') {
    worktree_record.slot = options.worktree_slot;
  }

  return worktree_record;
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
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * } | undefined} queue_wait
 * @returns {{
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * } | undefined}
 */
function createQueueWaitRecord(queue_wait) {
  if (queue_wait === undefined) {
    return undefined;
  }

  return {
    branch_head: queue_wait.branch_head,
    branch_ref: queue_wait.branch_ref,
    outcome: queue_wait.outcome,
    ready_ref: queue_wait.ready_ref,
    state: queue_wait.state,
  };
}

/**
 * @param {{
 *   data?: unknown,
 *   handler_name: string,
 *   kind: 'approval',
 * }} wait_state
 * @returns {{
 *   data?: unknown,
 *   handler_name: string,
 *   kind: 'approval',
 * }}
 */
function createWaitStateRecord(wait_state) {
  /** @type {{
   *   data?: unknown,
   *   handler_name: string,
   *   kind: 'approval',
   * }} */
  const wait_state_record = {
    handler_name: wait_state.handler_name,
    kind: 'approval',
  };

  if ('data' in wait_state) {
    wait_state_record.data = wait_state.data;
  }

  return wait_state_record;
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

/**
 * @param {unknown} state
 * @returns {state is 'failed' | 'succeeded' | 'waiting'}
 */
function isQueueWaitState(state) {
  return state === 'failed' || state === 'succeeded' || state === 'waiting';
}
