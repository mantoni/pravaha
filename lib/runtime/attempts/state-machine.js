/** @import { RunResult, ThreadOptions, TurnOptions } from '@openai/codex-sdk' */
/** @import { BuildGraphResult, QueryGraphApi } from '../../shared/types/patram-types.ts' */
import { Codex } from '@openai/codex-sdk';

import {
  cleanupStateMachineAttemptContext,
  createStateMachineAttemptContext,
} from '../../runtime-attempt-records.js';
import { createCurrentDate, createDefaultBindingTargets } from './result.js';
import { createResumedAttempt } from './state-machine-resume.js';
import { executeStateMachineAttempt } from './state-machine-execution.js';

export { resumeTaskAttempt, runStateMachineAttempt };

/**
 * @param {string} repo_directory
 * @param {{
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   ordered_jobs: Array<
 *     | {
 *         end_state: string,
 *         job_name: string,
 *         kind: 'end',
 *       }
 *     | {
 *         job_name: string,
 *         kind: 'action',
 *         limits: { max_visits: number } | null,
 *         next_branches: Array<{
 *           condition_text: string | null,
 *           target_job_name: string,
 *         }>,
 *         uses_value: string,
 *         with_value: unknown,
 *       }
 *   >,
 *   runtime_label: string,
 *   start_job_name: string,
 *   task_id: string,
 *   task_path: string,
 *   flow_path: string,
 *   worker_client?: {
 *     startThread: (thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
 *   },
 *   workspace: {
 *     materialize: {
 *       kind: 'worktree',
 *       mode: 'ephemeral' | 'pooled',
 *       ref: string,
 *     },
 *     source: {
 *       id: string,
 *       kind: 'repo',
 *     },
 *     type: 'git.workspace',
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'success',
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
async function runStateMachineAttempt(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const worker_client = options.worker_client ?? new Codex();
  const binding_targets =
    options.binding_targets ??
    createDefaultBindingTargets(options.task_id, options.task_path);
  const attempt_context = await createStateMachineAttemptContext(
    repo_directory,
    {
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      runtime_label: options.runtime_label,
      start_job_name: options.start_job_name,
      task_id: options.task_id,
      task_path: options.task_path,
      workspace: options.workspace,
    },
    now,
  );

  try {
    return await executeStateMachineAttempt(repo_directory, {
      attempt_context,
      now,
      operator_io: options.operator_io,
      ordered_jobs: options.ordered_jobs,
      runtime_record_context: {
        binding_targets,
        contract_path: options.contract_path,
        current_job_name: options.start_job_name,
        flow_path: options.flow_path,
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {},
        run_id: attempt_context.run_id,
        task_id: options.task_id,
        task_path: options.task_path,
      },
      worker_client,
    });
  } finally {
    await cleanupStateMachineAttemptContext(attempt_context);
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   durable_graph?: BuildGraphResult,
 *   graph_api?: QueryGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   relation_names?: string[],
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 *   worker_client?: {
 *     startThread: (thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'success',
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
  const { attempt_context, ordered_jobs } = await createResumedAttempt(
    repo_directory,
    {
      durable_graph: options.durable_graph,
      graph_api: options.graph_api,
      runtime_record: options.runtime_record,
      runtime_record_path: options.runtime_record_path,
    },
  );

  try {
    return await executeStateMachineAttempt(repo_directory, {
      attempt_context,
      now,
      operator_io: options.operator_io,
      ordered_jobs,
      runtime_record_context: {
        approval: attempt_context.approval,
        binding_targets: attempt_context.binding_targets,
        contract_path: attempt_context.contract_path,
        current_job_name: attempt_context.current_job_name,
        flow_path: attempt_context.flow_path,
        format_version: 'state-machine-v2',
        job_outputs: attempt_context.job_outputs,
        job_visit_counts: attempt_context.job_visit_counts,
        run_id: attempt_context.run_id,
        task_id: attempt_context.task_id,
        task_path: attempt_context.task_path,
      },
      worker_client: {
        startThread(thread_options) {
          return worker_client.startThread(thread_options);
        },
      },
    });
  } finally {
    await cleanupStateMachineAttemptContext(attempt_context);
  }
}
