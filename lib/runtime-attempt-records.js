import { join } from 'node:path';

import {
  RUNTIME_DIRECTORY,
  prepareWorktree,
  writeRuntimeRecord,
} from './runtime-files.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createRuntimeRecord,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordPrompt,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
} from './runtime-record-model.js';

export {
  createResumeAttemptContext,
  createTaskAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
};

/**
 * @typedef {{
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at?: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_targets: { failure: string, success: string },
 * }} RuntimeRecordContext
 */

/**
 * @typedef {{
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_path: string,
 * }} AttemptContext
 */

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   decision_paths?: string[],
 *   flow_path: string,
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 * }} options
 * @param {() => Date} now
 * @returns {Promise<AttemptContext>}
 */
async function createTaskAttemptContext(repo_directory, options, now) {
  const worktree_path = await prepareWorktree(repo_directory, options.task_id);
  const prompt = await createRuntimePrompt(repo_directory, {
    contract_path: options.contract_path,
    decision_paths: options.decision_paths ?? [],
    flow_path: options.flow_path,
    runtime_label: options.runtime_label,
    task_path: options.task_path,
  });

  return {
    prompt,
    runtime_record_path: join(
      repo_directory,
      RUNTIME_DIRECTORY,
      `${options.task_id}.json`,
    ),
    started_at: now().toISOString(),
    worktree_path,
  };
}

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {RuntimeRecordContext & AttemptContext & { worker_thread_id: string | null }}
 */
function createResumeAttemptContext(
  repo_directory,
  runtime_record,
  runtime_record_path,
) {
  const contract_path = readRequiredString(
    getRuntimeRecordContractPath(runtime_record),
    `Expected ${runtime_record_path} to record a contract path.`,
  );
  const flow_path = readRequiredString(
    getRuntimeRecordFlowPath(runtime_record),
    `Expected ${runtime_record_path} to record a flow path.`,
  );
  const leased_at = readRequiredString(
    getRuntimeRecordLeaseTime(runtime_record),
    `Expected ${runtime_record_path} to record a lease time.`,
  );
  const prompt = readRequiredString(
    getRuntimeRecordPrompt(runtime_record),
    `Expected ${runtime_record_path} to record a prompt.`,
  );
  const task_id = readRequiredString(
    getRuntimeRecordSelectedTaskId(runtime_record),
    `Expected ${runtime_record_path} to record a selected task id.`,
  );
  const task_path = readRequiredString(
    getRuntimeRecordSelectedTaskPath(runtime_record),
    `Expected ${runtime_record_path} to record a selected task path.`,
  );
  const worktree_path = readRequiredString(
    getRuntimeRecordWorktreePath(runtime_record),
    `Expected ${runtime_record_path} to record a worktree path.`,
  );
  const transition_targets = getRuntimeRecordTransitionTargets(runtime_record);

  if (transition_targets === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record transition targets.`,
    );
  }

  return {
    contract_path: normalizeRepoPath(repo_directory, contract_path),
    flow_path: normalizeRepoPath(repo_directory, flow_path),
    leased_at,
    prompt,
    runtime_record_path,
    task_id,
    task_path: normalizeRepoPath(repo_directory, task_path),
    transition_targets,
    worker_thread_id: getRuntimeRecordWorkerThreadId(runtime_record),
    worktree_path,
  };
}

/**
 * @param {RuntimeRecordContext} runtime_record_context
 * @param {AttemptContext} attempt_context
 * @param {string | null} worker_thread_id
 * @returns {Promise<void>}
 */
async function writeUnresolvedRuntimeRecord(
  runtime_record_context,
  attempt_context,
  worker_thread_id,
) {
  const leased_at =
    attempt_context.started_at ?? runtime_record_context.leased_at;

  if (typeof leased_at !== 'string') {
    throw new Error('Expected a lease time for the runtime record.');
  }

  await writeRuntimeRecord(
    attempt_context.runtime_record_path,
    createRuntimeRecord({
      contract_path: runtime_record_context.contract_path,
      flow_path: runtime_record_context.flow_path,
      leased_at,
      outcome: null,
      prompt: attempt_context.prompt,
      task_id: runtime_record_context.task_id,
      task_path: runtime_record_context.task_path,
      transition_targets: runtime_record_context.transition_targets,
      worker_error: null,
      worker_final_response: null,
      worker_item_count: 0,
      worker_thread_id,
      worker_usage: null,
      worktree_path: attempt_context.worktree_path,
    }),
  );
}

/**
 * @param {RuntimeRecordContext} runtime_record_context
 * @param {AttemptContext} attempt_context
 * @param {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: import('@openai/codex-sdk').Usage | null,
 * }} worker_result
 * @param {() => Date} now
 * @returns {Promise<void>}
 */
async function writeFinalRuntimeRecord(
  runtime_record_context,
  attempt_context,
  worker_result,
  now,
) {
  const leased_at =
    attempt_context.started_at ?? runtime_record_context.leased_at;

  if (typeof leased_at !== 'string') {
    throw new Error('Expected a lease time for the runtime record.');
  }

  await writeRuntimeRecord(
    attempt_context.runtime_record_path,
    createRuntimeRecord({
      completed_at: now().toISOString(),
      contract_path: runtime_record_context.contract_path,
      flow_path: runtime_record_context.flow_path,
      leased_at,
      outcome: worker_result.outcome,
      prompt: attempt_context.prompt,
      task_id: runtime_record_context.task_id,
      task_path: runtime_record_context.task_path,
      transition_targets: runtime_record_context.transition_targets,
      worker_error: worker_result.worker_error,
      worker_final_response: worker_result.worker_final_response,
      worker_item_count: worker_result.worker_item_count,
      worker_thread_id: worker_result.worker_thread_id,
      worker_usage: worker_result.worker_usage,
      worktree_path: attempt_context.worktree_path,
    }),
  );
}

/**
 * @param {string | null} value
 * @param {string} error_message
 * @returns {string}
 */
function readRequiredString(value, error_message) {
  if (typeof value !== 'string') {
    throw new Error(error_message);
  }

  return value;
}

/**
 * @param {string} repo_directory
 * @param {string} repo_path
 * @returns {string}
 */
function normalizeRepoPath(repo_directory, repo_path) {
  if (repo_path.startsWith(`${repo_directory}/`)) {
    return repo_path.slice(repo_directory.length + 1);
  }

  return repo_path;
}
