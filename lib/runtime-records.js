import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RUNTIME_DIRECTORY } from './runtime-files.js';
import {
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
} from './runtime-record-model.js';

export {
  createBlockedReconcileResult,
  listUnresolvedRuntimeRecords,
  loadSingleUnresolvedRuntimeRecord,
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
 * @returns {Promise<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>}
 */
async function loadSingleUnresolvedRuntimeRecord(repo_directory) {
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);

  if (unresolved_runtime_records.length === 0) {
    throw new Error('No unresolved runtime record is available to resume.');
  }

  if (unresolved_runtime_records.length > 1) {
    throw new Error(
      `Cannot resume because ${unresolved_runtime_records.length} unresolved runtime records exist.`,
    );
  }

  return unresolved_runtime_records[0];
}

/**
 * @param {string} repo_directory
 * @param {Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>} unresolved_runtime_records
 * @returns {{
 *   blocking_message: string,
 *   blocking_records: Array<{
 *     contract_path: string | null,
 *     leased_at: string | null,
 *     local_outcome_state: string,
 *     root_flow_path: string | null,
 *     runtime_record_path: string,
 *     task_id: string | null,
 *     task_path: string | null,
 *     worker_thread_id: string | null,
 *     worktree_path: string | null,
 *   }>,
 *   outcome: 'blocked',
 * }}
 */
function createBlockedReconcileResult(
  repo_directory,
  unresolved_runtime_records,
) {
  return {
    blocking_message:
      'Reconcile blocked by unresolved runtime state. Resume or resolve the recorded run before reconciling again.',
    blocking_records: unresolved_runtime_records.map(
      (unresolved_runtime_record) =>
        summarizeRuntimeRecord(
          repo_directory,
          unresolved_runtime_record.runtime_record_path,
          unresolved_runtime_record.record,
        ),
    ),
    outcome: 'blocked',
  };
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
 * @param {string} repo_directory
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {{
 *   contract_path: string | null,
 *   leased_at: string | null,
 *   local_outcome_state: string,
 *   root_flow_path: string | null,
 *   runtime_record_path: string,
 *   task_id: string | null,
 *   task_path: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string | null,
 * }}
 */
function summarizeRuntimeRecord(
  repo_directory,
  runtime_record_path,
  runtime_record,
) {
  return {
    contract_path: resolveRepoPath(
      repo_directory,
      getRuntimeRecordContractPath(runtime_record),
    ),
    leased_at: getRuntimeRecordLeaseTime(runtime_record),
    local_outcome_state: getRuntimeRecordLocalOutcomeState(runtime_record),
    root_flow_path: resolveRepoPath(
      repo_directory,
      getRuntimeRecordFlowPath(runtime_record),
    ),
    runtime_record_path,
    task_id: getRuntimeRecordSelectedTaskId(runtime_record),
    task_path: resolveRepoPath(
      repo_directory,
      getRuntimeRecordSelectedTaskPath(runtime_record),
    ),
    worker_thread_id: getRuntimeRecordWorkerThreadId(runtime_record),
    worktree_path: getRuntimeRecordWorktreePath(runtime_record),
  };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingPathError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * @param {string} repo_directory
 * @param {string | null} repo_path
 * @returns {string | null}
 */
function resolveRepoPath(repo_directory, repo_path) {
  if (typeof repo_path !== 'string') {
    return null;
  }

  return join(repo_directory, repo_path);
}
