/**
 * Operator-facing runtime status aggregation with durable fallback.
 *
 * Decided by: ../../../docs/decisions/runtime/live-status-command-with-durable-fallback.md
 * Implements: ../../../docs/contracts/runtime/status-command.md
 * @patram
 */
import process from 'node:process';

import {
  openProtocolConnection,
  resolveDispatchEndpoint,
  waitForMessage,
} from '../dispatch/protocol.js';
import { readRuntimeRecordFlowInstanceId } from '../dispatch/flow-instance.js';
import {
  listTerminalRuntimeRecords,
  listUnresolvedRuntimeRecords,
} from '../records/runtime-records.js';
import {
  createEmptyStatusGroups,
  createFlowSummary,
  resolveFlowStatus,
  sortStatusGroups,
} from './status-model.js';

export { status };

/**
 * @param {string} repo_directory
 * @param {{
 *   platform?: NodeJS.Platform,
 * }} [options]
 * @returns {Promise<{
 *   connected_worker_count: number,
 *   dispatcher_available: boolean,
 *   dispatcher_id: string | null,
 *   endpoint: string,
 *   flows_by_status: {
 *     failed: Array<Record<string, unknown>>,
 *     pending: Array<Record<string, unknown>>,
 *     running: Array<Record<string, unknown>>,
 *     succeeded: Array<Record<string, unknown>>,
 *     'waiting-approval': Array<Record<string, unknown>>,
 *     'waiting-queue': Array<Record<string, unknown>>,
 *   },
 *   outcome: 'success',
 * }>}
 */
async function status(repo_directory, options = {}) {
  const live_dispatcher_status = await readLiveDispatcherStatus(
    repo_directory,
    options.platform ?? process.platform,
  );
  const runtime_records = await listKnownRuntimeRecords(repo_directory);
  const active_assignments_by_flow_instance_id = new Map(
    live_dispatcher_status.active_assignments.map((active_assignment) => [
      active_assignment.flow_instance_id,
      active_assignment,
    ]),
  );
  const flows_by_status = createEmptyStatusGroups();

  for (const runtime_record of runtime_records) {
    const flow_instance_id = readRuntimeRecordFlowInstanceId(
      runtime_record.record,
    );
    const flow_status = resolveFlowStatus(
      runtime_record.record,
      flow_instance_id,
      active_assignments_by_flow_instance_id,
    );

    flows_by_status[flow_status].push(
      createFlowSummary(
        runtime_record.record,
        flow_instance_id,
        flow_status,
        active_assignments_by_flow_instance_id.get(flow_instance_id ?? ''),
      ),
    );
  }

  sortStatusGroups(flows_by_status);

  return {
    connected_worker_count: live_dispatcher_status.connected_worker_count,
    dispatcher_available: live_dispatcher_status.dispatcher_available,
    dispatcher_id: live_dispatcher_status.dispatcher_id,
    endpoint: live_dispatcher_status.endpoint,
    flows_by_status,
    outcome: 'success',
  };
}

/**
 * @param {string} repo_directory
 * @returns {Promise<Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>>}
 */
async function listKnownRuntimeRecords(repo_directory) {
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);
  const terminal_runtime_records =
    await listTerminalRuntimeRecords(repo_directory);

  return [...unresolved_runtime_records, ...terminal_runtime_records].sort(
    compareRuntimeRecords,
  );
}

/**
 * @param {string} repo_directory
 * @param {NodeJS.Platform} platform
 * @returns {Promise<{
 *   active_assignments: Array<{ flow_instance_id: string, worker_id: string }>,
 *   connected_worker_count: number,
 *   dispatcher_available: boolean,
 *   dispatcher_id: string | null,
 *   endpoint: string,
 * }>}
 */
async function readLiveDispatcherStatus(repo_directory, platform) {
  const endpoint = await resolveDispatchEndpoint(repo_directory, platform);
  const protocol_connection = await openProtocolConnection(endpoint.address);

  if (protocol_connection === null) {
    return {
      active_assignments: [],
      connected_worker_count: 0,
      dispatcher_available: false,
      dispatcher_id: null,
      endpoint: endpoint.address,
    };
  }

  try {
    protocol_connection.send({
      type: 'status_request',
    });

    const response_message = await waitForMessage(
      protocol_connection,
      'Expected the dispatcher to return a status report.',
    );

    if (response_message.type !== 'status_report') {
      throw new Error(
        `Expected status_report, received ${response_message.type}.`,
      );
    }

    protocol_connection.close();
    await protocol_connection.wait_until_closed();

    return {
      active_assignments: response_message.active_assignments,
      connected_worker_count: response_message.connected_worker_count,
      dispatcher_available: true,
      dispatcher_id: response_message.dispatcher_id,
      endpoint: endpoint.address,
    };
  } finally {
    protocol_connection.destroy();
  }
}

/**
 * @param {{ runtime_record_path: string }} left_runtime_record
 * @param {{ runtime_record_path: string }} right_runtime_record
 * @returns {number}
 */
function compareRuntimeRecords(left_runtime_record, right_runtime_record) {
  return left_runtime_record.runtime_record_path.localeCompare(
    right_runtime_record.runtime_record_path,
    'en',
  );
}
