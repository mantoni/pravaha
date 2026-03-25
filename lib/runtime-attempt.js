/** @import { RunResult, ThreadOptions, TurnOptions } from '@openai/codex-sdk' */
import { join } from 'node:path';

import { Codex } from '@openai/codex-sdk';

import { observeWorkerRun } from './run-happy-path-worker.js';
import {
  RUNTIME_DIRECTORY,
  prepareWorktree,
  writeRuntimeRecord,
} from './runtime-files.js';
import {
  createRuntimePrompt,
  createRuntimeRecord,
  projectTaskOutcome,
} from './runtime-attempt-support.js';

export { runTaskAttempt };

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   decision_paths?: string[],
 *   flow_path: string,
 *   now?: () => Date,
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_targets: { failure: string, success: string },
 *   worker_client?: {
 *     startThread: (thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function runTaskAttempt(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const worker_client = options.worker_client ?? new Codex();
  const attempt_context = await createTaskAttemptContext(
    repo_directory,
    options,
    now,
  );

  await writeInitialRuntimeRecord(options, attempt_context);

  const worker_result = await observeWorkerRun(
    worker_client,
    attempt_context.worktree_path,
    attempt_context.prompt,
  );

  await projectTaskOutcome(repo_directory, {
    outcome: worker_result.outcome,
    task_path: options.task_path,
    transition_targets: options.transition_targets,
  });

  await writeFinalRuntimeRecord(options, attempt_context, worker_result, now);

  return {
    contract_path: join(repo_directory, options.contract_path),
    outcome: worker_result.outcome,
    prompt: attempt_context.prompt,
    root_flow_path: join(repo_directory, options.flow_path),
    runtime_record_path: attempt_context.runtime_record_path,
    task_id: options.task_id,
    task_path: join(repo_directory, options.task_path),
    worker_error: worker_result.worker_error,
    worker_final_response: worker_result.worker_final_response,
    worker_thread_id: worker_result.worker_thread_id,
    worktree_path: attempt_context.worktree_path,
  };
}

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
 * @returns {Promise<{
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at: string,
 *   worktree_path: string,
 * }>}
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
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   task_id: string,
 *   task_path: string,
 * }} options
 * @param {{
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at: string,
 *   worktree_path: string,
 * }} attempt_context
 * @returns {Promise<void>}
 */
async function writeInitialRuntimeRecord(options, attempt_context) {
  await writeRuntimeRecord(
    attempt_context.runtime_record_path,
    createRuntimeRecord({
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      leased_at: attempt_context.started_at,
      outcome: null,
      prompt: attempt_context.prompt,
      task_id: options.task_id,
      task_path: options.task_path,
      worker_error: null,
      worker_final_response: null,
      worker_item_count: 0,
      worker_thread_id: null,
      worker_usage: null,
      worktree_path: attempt_context.worktree_path,
    }),
  );
}

/**
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   task_id: string,
 *   task_path: string,
 * }} options
 * @param {{
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at: string,
 *   worktree_path: string,
 * }} attempt_context
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
  options,
  attempt_context,
  worker_result,
  now,
) {
  await writeRuntimeRecord(
    attempt_context.runtime_record_path,
    createRuntimeRecord({
      completed_at: now().toISOString(),
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      leased_at: attempt_context.started_at,
      outcome: worker_result.outcome,
      prompt: attempt_context.prompt,
      task_id: options.task_id,
      task_path: options.task_path,
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
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}
