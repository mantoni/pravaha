/** @import { RunResult, ThreadOptions, TurnOptions } from '@openai/codex-sdk' */
import { join } from 'node:path';

import { Codex } from '@openai/codex-sdk';

import { observeWorkerRun } from './run-happy-path-worker.js';
import { projectTaskOutcome } from './runtime-attempt-support.js';
import {
  createResumeAttemptContext,
  createTaskAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';

export { resumeTaskAttempt, runTaskAttempt };

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

  await writeUnresolvedRuntimeRecord(options, attempt_context, null);

  const worker_result = await observeWorkerRun(
    worker_client,
    attempt_context.worktree_path,
    attempt_context.prompt,
    {
      on_thread_opened(worker_thread_id) {
        return writeUnresolvedRuntimeRecord(
          options,
          attempt_context,
          worker_thread_id,
        );
      },
    },
  );

  await writeFinalRuntimeRecord(options, attempt_context, worker_result, now);
  await projectTaskOutcome(repo_directory, {
    outcome: worker_result.outcome,
    task_path: options.task_path,
    transition_targets: options.transition_targets,
  });

  return createRunResult(repo_directory, {
    contract_path: options.contract_path,
    flow_path: options.flow_path,
    runtime_record_path: attempt_context.runtime_record_path,
    task_id: options.task_id,
    task_path: options.task_path,
    worker_result,
    worktree_path: attempt_context.worktree_path,
    prompt: attempt_context.prompt,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   now?: () => Date,
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 *   worker_client?: {
 *     resumeThread?: (id: string, thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
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
async function resumeTaskAttempt(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const worker_client = options.worker_client ?? new Codex();
  const attempt_context = createResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );

  await writeUnresolvedRuntimeRecord(
    attempt_context,
    attempt_context,
    attempt_context.worker_thread_id,
  );

  const worker_result = await observeWorkerRun(
    worker_client,
    attempt_context.worktree_path,
    attempt_context.prompt,
    {
      on_thread_opened(worker_thread_id) {
        return writeUnresolvedRuntimeRecord(
          attempt_context,
          attempt_context,
          worker_thread_id,
        );
      },
      worker_thread_id: attempt_context.worker_thread_id,
    },
  );

  await writeFinalRuntimeRecord(
    attempt_context,
    attempt_context,
    worker_result,
    now,
  );
  await projectTaskOutcome(repo_directory, {
    outcome: worker_result.outcome,
    task_path: attempt_context.task_path,
    transition_targets: attempt_context.transition_targets,
  });

  return createRunResult(repo_directory, {
    contract_path: attempt_context.contract_path,
    flow_path: attempt_context.flow_path,
    runtime_record_path: attempt_context.runtime_record_path,
    task_id: attempt_context.task_id,
    task_path: attempt_context.task_path,
    worker_result,
    worktree_path: attempt_context.worktree_path,
    prompt: attempt_context.prompt,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   prompt: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_thread_id: string | null,
 *   },
 *   worktree_path: string,
 * }} options
 * @returns {{
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
 * }}
 */
function createRunResult(repo_directory, options) {
  return {
    contract_path: join(repo_directory, options.contract_path),
    outcome: options.worker_result.outcome,
    prompt: options.prompt,
    root_flow_path: join(repo_directory, options.flow_path),
    runtime_record_path: options.runtime_record_path,
    task_id: options.task_id,
    task_path: join(repo_directory, options.task_path),
    worker_error: options.worker_result.worker_error,
    worker_final_response: options.worker_result.worker_final_response,
    worker_thread_id: options.worker_result.worker_thread_id,
    worktree_path: options.worktree_path,
  };
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}
