/**
 * Status grouping and summary projection for operator-facing flow visibility.
 *
 * Decided by: ../../../docs/decisions/runtime/live-status-command-with-durable-fallback.md
 * Implements: ../../../docs/contracts/runtime/status-command.md
 * @patram
 */
import {
  getRuntimeRecordApproval,
  getRuntimeRecordContractPath,
  getRuntimeRecordCurrentJobName,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordQueueWait,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreePath,
} from '../records/runtime-record-model.js';

export {
  createEmptyStatusGroups,
  createFlowSummary,
  resolveFlowStatus,
  sortStatusGroups,
};

/**
 * @returns {{
 *   failed: Array<Record<string, unknown>>,
 *   pending: Array<Record<string, unknown>>,
 *   running: Array<Record<string, unknown>>,
 *   succeeded: Array<Record<string, unknown>>,
 *   'waiting-approval': Array<Record<string, unknown>>,
 *   'waiting-queue': Array<Record<string, unknown>>,
 * }}
 */
function createEmptyStatusGroups() {
  return {
    failed: [],
    pending: [],
    running: [],
    succeeded: [],
    'waiting-approval': [],
    'waiting-queue': [],
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {string | null} flow_instance_id
 * @param {Map<string, { flow_instance_id: string, worker_id: string }>} active_assignments_by_flow_instance_id
 * @returns {'failed' | 'pending' | 'running' | 'succeeded' | 'waiting-approval' | 'waiting-queue'}
 */
function resolveFlowStatus(
  runtime_record,
  flow_instance_id,
  active_assignments_by_flow_instance_id,
) {
  if (
    typeof flow_instance_id === 'string' &&
    active_assignments_by_flow_instance_id.has(flow_instance_id)
  ) {
    return 'running';
  }

  const local_outcome_state = getRuntimeRecordLocalOutcomeState(runtime_record);

  if (local_outcome_state === 'success') {
    return 'succeeded';
  }

  if (local_outcome_state === 'failure') {
    return 'failed';
  }

  const approval = getRuntimeRecordApproval(runtime_record);

  if (approval?.approved_at === null) {
    return 'waiting-approval';
  }

  const queue_wait = getRuntimeRecordQueueWait(runtime_record);

  if (queue_wait?.state === 'waiting') {
    return 'waiting-queue';
  }

  return 'pending';
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {string | null} flow_instance_id
 * @param {'failed' | 'pending' | 'running' | 'succeeded' | 'waiting-approval' | 'waiting-queue'} flow_status
 * @param {{ flow_instance_id: string, worker_id: string } | undefined} active_assignment
 * @returns {Record<string, unknown>}
 */
function createFlowSummary(
  runtime_record,
  flow_instance_id,
  flow_status,
  active_assignment,
) {
  /** @type {Record<string, unknown>} */
  const flow_summary = {};

  assignStringField(flow_summary, 'flow_instance_id', flow_instance_id);
  assignStringField(
    flow_summary,
    'contract_path',
    getRuntimeRecordContractPath(runtime_record),
  );
  assignStringField(
    flow_summary,
    'current_job_name',
    getRuntimeRecordCurrentJobName(runtime_record),
  );
  assignStringField(
    flow_summary,
    'flow_path',
    getRuntimeRecordFlowPath(runtime_record),
  );
  assignStringField(
    flow_summary,
    'run_id',
    getRuntimeRecordRunId(runtime_record),
  );
  assignStringField(
    flow_summary,
    'task_id',
    getRuntimeRecordSelectedTaskId(runtime_record),
  );
  assignStringField(
    flow_summary,
    'task_path',
    getRuntimeRecordSelectedTaskPath(runtime_record),
  );

  if (flow_status !== 'running') {
    return flow_summary;
  }

  assignStringField(
    flow_summary,
    'checkout_directory',
    getRuntimeRecordWorktreePath(runtime_record),
  );
  assignStringField(flow_summary, 'worker_id', active_assignment?.worker_id);

  return flow_summary;
}

/**
 * @param {{
 *   failed: Array<Record<string, unknown>>,
 *   pending: Array<Record<string, unknown>>,
 *   running: Array<Record<string, unknown>>,
 *   succeeded: Array<Record<string, unknown>>,
 *   'waiting-approval': Array<Record<string, unknown>>,
 *   'waiting-queue': Array<Record<string, unknown>>,
 * }} flows_by_status
 * @returns {void}
 */
function sortStatusGroups(flows_by_status) {
  flows_by_status.failed.sort(compareFlowSummaries);
  flows_by_status.pending.sort(compareFlowSummaries);
  flows_by_status.running.sort(compareFlowSummaries);
  flows_by_status.succeeded.sort(compareFlowSummaries);
  flows_by_status['waiting-approval'].sort(compareFlowSummaries);
  flows_by_status['waiting-queue'].sort(compareFlowSummaries);
}

/**
 * @param {Record<string, unknown>} flow_summary
 * @param {string} field_name
 * @param {string | null | undefined} value
 * @returns {void}
 */
function assignStringField(flow_summary, field_name, value) {
  if (typeof value === 'string') {
    flow_summary[field_name] = value;
  }
}

/**
 * @param {Record<string, unknown>} left_summary
 * @param {Record<string, unknown>} right_summary
 * @returns {number}
 */
function compareFlowSummaries(left_summary, right_summary) {
  return readComparableSummaryValue(left_summary).localeCompare(
    readComparableSummaryValue(right_summary),
    'en',
  );
}

/**
 * @param {Record<string, unknown>} flow_summary
 * @returns {string}
 */
function readComparableSummaryValue(flow_summary) {
  if (typeof flow_summary.flow_instance_id === 'string') {
    return flow_summary.flow_instance_id;
  }

  if (typeof flow_summary.task_path === 'string') {
    return flow_summary.task_path;
  }

  return JSON.stringify(flow_summary);
}
