/**
 * Runtime record loading for unresolved worker-pool attempts.
 *
 * Decided by: ../../../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Decided by: ../../../docs/decisions/runtime/approval-only-command-ingress.md
 * Implements: ../../../docs/contracts/runtime/local-dispatch-runtime.md
 * Implements: ../../../docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
 * @patram
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RUNTIME_DIRECTORY } from '../workspaces/runtime-files.js';
import {
  getRuntimeRecordApproval,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordRunId,
} from './runtime-record-model.js';

export {
  listUnresolvedRuntimeRecords,
  loadSingleUnresolvedRuntimeRecordByToken,
};

/**
 * @param {string} repo_directory
 * @returns {Promise<Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>>}
 */
async function listUnresolvedRuntimeRecords(repo_directory) {
  /** @type {Array<{ record: Record<string, unknown>, runtime_record_path: string }>} */
  const unresolved_runtime_records = [];
  const runtime_directory = join(repo_directory, RUNTIME_DIRECTORY);
  let runtime_directory_entries;

  try {
    runtime_directory_entries = await readdir(runtime_directory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (isMissingPathError(error)) {
      return unresolved_runtime_records;
    }

    throw error;
  }

  for (const runtime_directory_entry of runtime_directory_entries) {
    if (
      !runtime_directory_entry.isFile() ||
      !runtime_directory_entry.name.endsWith('.json')
    ) {
      continue;
    }

    const runtime_record_path = join(
      runtime_directory,
      runtime_directory_entry.name,
    );
    const runtime_record = await loadRuntimeRecord(runtime_record_path);

    if (
      !isTerminalLocalOutcome(getRuntimeRecordLocalOutcomeState(runtime_record))
    ) {
      unresolved_runtime_records.push({
        record: runtime_record,
        runtime_record_path,
      });
    }
  }

  unresolved_runtime_records.sort((left_record, right_record) =>
    left_record.runtime_record_path.localeCompare(
      right_record.runtime_record_path,
    ),
  );

  return unresolved_runtime_records;
}

/**
 * @param {string} repo_directory
 * @param {string} approval_token
 * @returns {Promise<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>}
 */
async function loadSingleUnresolvedRuntimeRecordByToken(
  repo_directory,
  approval_token,
) {
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);
  const matching_runtime_records = unresolved_runtime_records.filter(
    (runtime_record) =>
      getRuntimeRecordRunId(runtime_record.record) === approval_token &&
      isRuntimeRecordWaitingForApproval(runtime_record.record),
  );

  if (matching_runtime_records.length === 0) {
    throw new Error(
      `No unresolved runtime record is waiting for approval token "${approval_token}".`,
    );
  }

  if (matching_runtime_records.length > 1) {
    throw new Error(
      `Cannot approve because ${matching_runtime_records.length} unresolved runtime records share approval token "${approval_token}".`,
    );
  }

  return matching_runtime_records[0];
}
/**
 * @param {string} runtime_record_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadRuntimeRecord(runtime_record_path) {
  return /** @type {Record<string, unknown>} */ (
    JSON.parse(await readFile(runtime_record_path, 'utf8'))
  );
}

/**
 * @param {string} local_outcome_state
 * @returns {boolean}
 */
function isTerminalLocalOutcome(local_outcome_state) {
  return local_outcome_state === 'success' || local_outcome_state === 'failure';
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {boolean}
 */
function isRuntimeRecordWaitingForApproval(runtime_record) {
  const approval = getRuntimeRecordApproval(runtime_record);

  return approval !== null && approval.approved_at === null;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingPathError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
