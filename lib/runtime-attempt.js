/* eslint-disable complexity, max-lines, max-lines-per-function */
/** @import { RunResult, ThreadOptions, TurnOptions, Usage } from '@openai/codex-sdk' */
/** @import { BuildGraphResult, QueryGraphApi } from './patram-types.ts' */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Codex } from '@openai/codex-sdk';

import { execGitFile } from './git-process.js';
import { loadStepPlugin } from './plugin-loader.js';
import { observeWorkerRun } from './run-happy-path-worker.js';
import { loadStateMachineFlow } from './reconcile-flow.js';
import {
  cleanupStateMachineAttemptContext,
  createStateMachineAttemptContext,
  createStateMachineResumeAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';
import {
  renderStateMachineValue,
  selectStateMachineNextTarget,
} from './state-machine-runtime.js';

const exec_file = promisify(execFile);
const NOOP_OPERATOR_IO = {
  stderr: {
    write() {
      return true;
    },
  },
  stdout: {
    write() {
      return true;
    },
  },
};

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
  const attempt_context = createStateMachineResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );
  const state_machine_flow = await loadStateMachineFlow(
    repo_directory,
    attempt_context.flow_path,
  );

  return executeStateMachineAttempt(repo_directory, {
    attempt_context,
    now,
    operator_io: options.operator_io,
    ordered_jobs: state_machine_flow.ordered_jobs,
    runtime_record_context: {
      approval: attempt_context.approval,
      binding_targets: attempt_context.binding_targets,
      contract_path: attempt_context.contract_path,
      current_job_name: attempt_context.current_job_name,
      flow_path: attempt_context.flow_path,
      format_version: 'state-machine-v2',
      job_outputs: attempt_context.job_outputs ?? {},
      job_visit_counts: attempt_context.job_visit_counts ?? {},
      leased_at: attempt_context.leased_at,
      run_id: attempt_context.run_id,
      task_id: attempt_context.task_id,
      task_path: attempt_context.task_path,
    },
    worker_client: {
      startThread(thread_options) {
        if (
          worker_client.resumeThread !== undefined &&
          typeof attempt_context.worker_thread_id === 'string'
        ) {
          return worker_client.resumeThread(
            attempt_context.worker_thread_id,
            thread_options,
          );
        }

        return worker_client.startThread(thread_options);
      },
    },
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   attempt_context: {
 *     current_job_name?: string,
 *     job_outputs?: Record<string, Record<string, unknown>>,
 *     job_visit_counts?: Record<string, number>,
 *     prompt: string,
 *     run_id?: string,
 *     runtime_record_path: string,
 *     started_at?: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   now: () => Date,
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
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     contract_path: string,
 *     current_job_name: string,
 *     flow_path: string,
 *     format_version: 'state-machine-v2',
 *     job_outputs: Record<string, Record<string, unknown>>,
 *     job_visit_counts: Record<string, number>,
 *     leased_at?: string,
 *     run_id?: string,
 *     task_id: string,
 *     task_path: string,
 *   },
 *   worker_client: {
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
async function executeStateMachineAttempt(repo_directory, options) {
  const ordered_jobs = createStateMachineJobMap(options.ordered_jobs);
  const binding_targets = readBindingTargets(
    options.runtime_record_context.binding_targets,
  );
  const task_context =
    /** @type {{ id: string, path: string, status: string }} */ (
      binding_targets.task
    );
  const document_context = binding_targets.document;
  /** @type {Record<string, Record<string, unknown>>} */
  const job_outputs = {
    ...options.runtime_record_context.job_outputs,
  };
  /** @type {Record<string, number>} */
  const job_visit_counts = {
    ...options.runtime_record_context.job_visit_counts,
  };
  /** @type {{
   *   approved_at: string | null,
   *   requested_at: string,
   * } | undefined} */
  let approval = options.runtime_record_context.approval;
  let current_job_name = options.runtime_record_context.current_job_name;
  let worker_result = createEmptyWorkerResult(null);

  while (true) {
    const current_job = ordered_jobs.get(current_job_name);

    if (current_job === undefined) {
      throw new Error(`Unknown state-machine job "${current_job_name}".`);
    }

    if (current_job.kind === 'end') {
      return finalizeStateMachineAttempt(
        repo_directory,
        options,
        current_job.end_state === 'success' ? 'success' : 'failure',
        current_job.end_state === 'success'
          ? worker_result
          : {
              ...worker_result,
              outcome: 'failure',
              worker_error:
                worker_result.worker_error ??
                `State-machine ended in terminal state "${current_job.end_state}".`,
            },
        current_job_name,
        job_outputs,
        job_visit_counts,
        approval,
      );
    }

    const next_visit_count = (job_visit_counts[current_job_name] ?? 0) + 1;
    job_visit_counts[current_job_name] = next_visit_count;

    if (
      current_job.limits !== null &&
      next_visit_count > current_job.limits.max_visits
    ) {
      return finalizeStateMachineAttempt(
        repo_directory,
        options,
        'failure',
        createStateMachineFailureWorkerResult(
          worker_result,
          `State-machine job "${current_job_name}" exceeded max-visits (${current_job.limits.max_visits}).`,
        ),
        current_job_name,
        job_outputs,
        job_visit_counts,
        approval,
      );
    }

    await writeUnresolvedRuntimeRecord(
      createStateMachineRuntimeRecordContext(
        options.runtime_record_context,
        current_job_name,
        job_outputs,
        job_visit_counts,
        approval,
      ),
      createStateMachineWriteAttemptContext(
        options.attempt_context,
        current_job_name,
        job_outputs,
        job_visit_counts,
      ),
      worker_result.worker_thread_id,
    );

    const action_result = await executeStateMachineAction(repo_directory, {
      approval,
      base_prompt: options.attempt_context.prompt,
      current_job_name,
      document: document_context,
      jobs_context: createStateMachineJobsContext(job_outputs),
      now: options.now,
      operator_io: options.operator_io,
      run_id: options.attempt_context.run_id ?? null,
      task: task_context,
      uses_value: current_job.uses_value,
      with_value: current_job.with_value,
      worker_client: options.worker_client,
      worker_thread_id: worker_result.worker_thread_id,
      worktree_path: options.attempt_context.worktree_path,
    });

    approval = action_result.approval;
    worker_result = action_result.worker_result;

    if (action_result.outcome === 'pending-approval') {
      await writeUnresolvedRuntimeRecord(
        createStateMachineRuntimeRecordContext(
          options.runtime_record_context,
          current_job_name,
          job_outputs,
          job_visit_counts,
          approval,
        ),
        createStateMachineWriteAttemptContext(
          options.attempt_context,
          current_job_name,
          job_outputs,
          job_visit_counts,
        ),
        worker_result.worker_thread_id,
      );

      return createRunResult(repo_directory, {
        contract_path: options.runtime_record_context.contract_path,
        flow_path: options.runtime_record_context.flow_path,
        outcome: 'pending-approval',
        prompt: options.attempt_context.prompt,
        runtime_record_path: options.attempt_context.runtime_record_path,
        task_id: options.runtime_record_context.task_id,
        task_path: options.runtime_record_context.task_path,
        worker_result,
        worktree_path: options.attempt_context.worktree_path,
      });
    }

    job_outputs[current_job_name] = action_result.result;
    const next_job_name = selectStateMachineNextTarget(
      current_job.next_branches,
      {
        document: document_context,
        jobs: createStateMachineJobsContext(job_outputs),
        result: action_result.result,
        task: task_context,
      },
    );

    if (next_job_name === null) {
      return finalizeStateMachineAttempt(
        repo_directory,
        options,
        'failure',
        createStateMachineFailureWorkerResult(
          worker_result,
          `State-machine job "${current_job_name}" did not match any next branch.`,
        ),
        current_job_name,
        job_outputs,
        job_visit_counts,
        approval,
      );
    }

    current_job_name = next_job_name;
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   attempt_context: {
 *     ordered_steps?: Array<
 *       | { command_text: string, kind: 'run' }
 *       | { kind: 'uses', step_name: string, with_value?: unknown }
 *     >,
 *     prompt: string,
 *     runtime_record_path: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   durable_graph: BuildGraphResult,
 *   flow_id: string,
 *   graph_api: QueryGraphApi,
 *   now: () => Date,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   outcome: 'failure' | 'success',
 *   relation_names: string[],
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     await_query?: string,
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     contract_path: string,
 *     flow_path: string,
 *     leased_at?: string,
 *     ordered_steps?: Array<
 *       | { command_text: string, kind: 'run' }
 *       | { kind: 'uses', step_name: string, with_value?: unknown }
 *     >,
 *     signals?: Array<{
 *       emitted_at: string,
 *       kind: string,
 *       payload: Record<string, unknown>,
 *       subject: 'document' | 'task',
 *     }>,
 *     task_id: string,
 *     task_path: string,
 *     transition_conditions?: { failure: string, success: string },
 *     transition_target_bindings?: { failure: string, success: string },
 *     transition_targets?: { failure: string, success: string },
 *   },
 *   should_project_outcome: boolean,
 *   task_error: string | null,
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     subject: 'document' | 'task',
 *   }>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
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
/**
 * @param {string} repo_directory
 * @param {{
 *   attempt_context: {
 *     current_job_name?: string,
 *     job_outputs?: Record<string, Record<string, unknown>>,
 *     job_visit_counts?: Record<string, number>,
 *     prompt: string,
 *     runtime_record_path: string,
 *     started_at?: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     contract_path: string,
 *     current_job_name: string,
 *     flow_path: string,
 *     format_version: 'state-machine-v2',
 *     job_outputs: Record<string, Record<string, unknown>>,
 *     job_visit_counts: Record<string, number>,
 *     run_id?: string,
 *     task_id: string,
 *     task_path: string,
 *   },
 *   now: () => Date,
 * }} options
 * @param {'failure' | 'success'} outcome
 * @param {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }} worker_result
 * @param {string} [current_job_name]
 * @param {Record<string, Record<string, unknown>>} [job_outputs]
 * @param {Record<string, number>} [job_visit_counts]
 * @param {{
 *   approved_at: string | null,
 *   requested_at: string,
 * } | undefined} [approval]
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
async function finalizeStateMachineAttempt(
  repo_directory,
  options,
  outcome,
  worker_result,
  current_job_name = options.runtime_record_context.current_job_name,
  job_outputs = options.runtime_record_context.job_outputs,
  job_visit_counts = options.runtime_record_context.job_visit_counts,
  approval = options.runtime_record_context.approval,
) {
  await writeFinalRuntimeRecord(
    createStateMachineRuntimeRecordContext(
      options.runtime_record_context,
      current_job_name,
      job_outputs,
      job_visit_counts,
      approval,
    ),
    createStateMachineWriteAttemptContext(
      options.attempt_context,
      current_job_name,
      job_outputs,
      job_visit_counts,
    ),
    worker_result,
    options.now,
  );

  return createRunResult(repo_directory, {
    contract_path: options.runtime_record_context.contract_path,
    flow_path: options.runtime_record_context.flow_path,
    outcome,
    prompt: options.attempt_context.prompt,
    runtime_record_path: options.attempt_context.runtime_record_path,
    task_id: options.runtime_record_context.task_id,
    task_path: options.runtime_record_context.task_path,
    worker_result,
    worktree_path: options.attempt_context.worktree_path,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   base_prompt: string,
 *   current_job_name: string,
 *   document?: { id: string, path: string, status: string },
 *   jobs_context: Record<string, { outputs: Record<string, unknown> }>,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   run_id: string | null,
 *   task: { id: string, path: string, status: string },
 *   uses_value: string,
 *   with_value: unknown,
 *   worker_client: {
 *     startThread: (thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
 *   },
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed' | 'pending-approval',
 *   result: Record<string, unknown>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
 *   },
 * }>}
 */
async function executeStateMachineAction(repo_directory, options) {
  const context = {
    document: options.document,
    jobs: options.jobs_context,
    result: {},
    task: options.task,
  };
  const rendered_with_value = renderStateMachineValue(
    options.with_value,
    context,
  );

  if (options.uses_value === 'core/agent') {
    return executeCoreAgentAction(options, rendered_with_value);
  }

  if (options.uses_value === 'core/run') {
    return executeCoreRunAction(
      options,
      /** @type {{ capture?: ('stderr' | 'stdout')[], command: string }} */ (
        rendered_with_value
      ),
    );
  }

  if (options.uses_value === 'core/approval') {
    return executeCoreApprovalAction(options);
  }

  if (options.uses_value === 'core/git-status') {
    return executeCoreGitStatusAction(options);
  }

  if (options.uses_value === 'core/flow-dispatch') {
    const with_value =
      /** @type {{ flow?: string, inputs?: Record<string, unknown>, wait?: boolean }} */ (
        rendered_with_value
      );

    return {
      approval: options.approval,
      outcome: 'completed',
      result: {
        dispatched: true,
        flow: with_value.flow ?? null,
        inputs: with_value.inputs ?? {},
        wait: with_value.wait ?? false,
      },
      worker_result: createEmptyWorkerResult(options.worker_thread_id),
    };
  }

  const plugin_result = await executePluginStep(repo_directory, {
    now: options.now,
    operator_io: options.operator_io,
    ordered_step: {
      kind: 'uses',
      step_name: options.uses_value,
      with_value: rendered_with_value,
    },
    runtime_record_context: {
      approval: options.approval,
      binding_targets: createPluginBindingTargets(
        options.document,
        options.task,
      ),
      run_id: options.run_id ?? undefined,
    },
    runtime_signals: [],
    worktree_path: options.worktree_path,
  });

  return {
    approval: plugin_result.approval,
    outcome: plugin_result.outcome,
    result: normalizeStateMachineResultValue(plugin_result.result),
    worker_result: createEmptyWorkerResult(options.worker_thread_id),
  };
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   base_prompt: string,
 *   now: () => Date,
 *   uses_value: string,
 *   worker_client: {
 *     startThread: (thread_options?: ThreadOptions) => {
 *       id: string | null,
 *       run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *     },
 *   },
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} options
 * @param {unknown} rendered_with_value
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed',
 *   result: Record<string, unknown>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
 *   },
 * }>}
 */
async function executeCoreAgentAction(options, rendered_with_value) {
  const with_value = /** @type {{ prompt: string, provider: string }} */ (
    rendered_with_value
  );

  if (with_value.provider !== 'codex-sdk') {
    throw new Error(
      `Unsupported core/agent provider "${with_value.provider}".`,
    );
  }

  const worker_result = await observeWorkerRun(
    options.worker_client,
    options.worktree_path,
    `${options.base_prompt}\n\nTask instruction:\n${with_value.prompt}`,
    {
      worker_thread_id: options.worker_thread_id,
    },
  );

  if (worker_result.outcome === 'failure') {
    return {
      approval: options.approval,
      outcome: 'completed',
      result: {
        error: worker_result.worker_error,
        outcome: 'failure',
      },
      worker_result,
    };
  }

  return {
    approval: options.approval,
    outcome: 'completed',
    result: {
      outcome: 'success',
      provider: with_value.provider,
      summary: worker_result.worker_final_response ?? '',
    },
    worker_result,
  };
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   now: () => Date,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} options
 * @param {{ capture?: ('stderr' | 'stdout')[], command: string }} with_value
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed',
 *   result: Record<string, unknown>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
 *   },
 * }>}
 */
async function executeCoreRunAction(options, with_value) {
  try {
    const result = await exec_file('/bin/sh', ['-c', with_value.command], {
      cwd: options.worktree_path,
      encoding: 'utf8',
    });

    return {
      approval: options.approval,
      outcome: 'completed',
      result: createCoreRunResult(0, result, with_value.capture),
      worker_result: createEmptyWorkerResult(options.worker_thread_id),
    };
  } catch (error) {
    if (isExecError(error)) {
      return {
        approval: options.approval,
        outcome: 'completed',
        result: createCoreRunResult(error.code ?? 1, error, with_value.capture),
        worker_result: createEmptyWorkerResult(options.worker_thread_id),
      };
    }

    throw error;
  }
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   run_id: string | null,
 *   worker_thread_id: string | null,
 * }} options
 * @returns {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed' | 'pending-approval',
 *   result: Record<string, unknown>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
 *   },
 * }}
 */
function executeCoreApprovalAction(options) {
  if (
    options.approval?.approved_at === null ||
    options.approval === undefined
  ) {
    writeApprovalInstruction(
      resolveOperatorIo(options.operator_io).stdout,
      options.run_id ?? 'current-run',
    );

    return {
      approval: {
        approved_at: null,
        requested_at:
          options.approval?.requested_at ?? options.now().toISOString(),
      },
      outcome: 'pending-approval',
      result: {},
      worker_result: createEmptyWorkerResult(options.worker_thread_id),
    };
  }

  return {
    approval: options.approval,
    outcome: 'completed',
    result: {
      verdict: 'approve',
    },
    worker_result: createEmptyWorkerResult(options.worker_thread_id),
  };
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed',
 *   result: Record<string, unknown>,
 *   worker_result: {
 *     outcome: 'failure' | 'success',
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_item_count: number,
 *     worker_thread_id: string | null,
 *     worker_usage: Usage | null,
 *   },
 * }>}
 */
async function executeCoreGitStatusAction(options) {
  const head_result = await execGitFile(['rev-parse', 'HEAD'], {
    cwd: options.worktree_path,
    encoding: 'utf8',
  });
  const status_result = await execGitFile(['status', '--porcelain'], {
    cwd: options.worktree_path,
    encoding: 'utf8',
  });

  return {
    approval: options.approval,
    outcome: 'completed',
    result: {
      dirty: status_result.stdout.trim() !== '',
      head: head_result.stdout.trim(),
    },
    worker_result: createEmptyWorkerResult(options.worker_thread_id),
  };
}

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'success',
 *   prompt: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_result: {
 *     worker_error: string | null,
 *     worker_final_response: string | null,
 *     worker_thread_id: string | null,
 *   },
 *   worktree_path: string,
 * }} options
 * @returns {{
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
 * }}
 */
function createRunResult(repo_directory, options) {
  return {
    contract_path: join(repo_directory, options.contract_path),
    outcome: options.outcome,
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
 * @param {{
 *   next_step_index?: number,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }} attempt_context
 * @param {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >} ordered_steps
 * @param {number} next_step_index
 * @returns {{
 *   next_step_index: number,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }}
 */
/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   current_job_name: string,
 *   flow_path: string,
 *   format_version: 'state-machine-v2',
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 * }} runtime_record_context
 * @param {string} current_job_name
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @param {Record<string, number>} job_visit_counts
 * @param {{
 *   approved_at: string | null,
 *   requested_at: string,
 * } | undefined} approval
 * @returns {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   current_job_name: string,
 *   flow_path: string,
 *   format_version: 'state-machine-v2',
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_targets?: { failure: string, success: string },
 * }}
 */
function createStateMachineRuntimeRecordContext(
  runtime_record_context,
  current_job_name,
  job_outputs,
  job_visit_counts,
  approval,
) {
  return {
    ...runtime_record_context,
    approval,
    current_job_name,
    job_outputs,
    job_visit_counts,
  };
}

/**
 * @param {{
 *   current_job_name?: string,
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   prompt: string,
 *   run_id?: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }} attempt_context
 * @param {string} current_job_name
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @param {Record<string, number>} job_visit_counts
 * @returns {{
 *   current_job_name: string,
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   prompt: string,
 *   run_id?: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }}
 */
function createStateMachineWriteAttemptContext(
  attempt_context,
  current_job_name,
  job_outputs,
  job_visit_counts,
) {
  return {
    ...attempt_context,
    current_job_name,
    job_outputs,
    job_visit_counts,
  };
}

/**
 * @param {Array<
 *   | {
 *       end_state: string,
 *       job_name: string,
 *       kind: 'end',
 *     }
 *   | {
 *       job_name: string,
 *       kind: 'action',
 *       limits: { max_visits: number } | null,
 *       next_branches: Array<{
 *         condition_text: string | null,
 *         target_job_name: string,
 *       }>,
 *       uses_value: string,
 *       with_value: unknown,
 *     }
 * >} ordered_jobs
 * @returns {Map<
 *   string,
 *   | {
 *       end_state: string,
 *       job_name: string,
 *       kind: 'end',
 *     }
 *   | {
 *       job_name: string,
 *       kind: 'action',
 *       limits: { max_visits: number } | null,
 *       next_branches: Array<{
 *         condition_text: string | null,
 *         target_job_name: string,
 *       }>,
 *       uses_value: string,
 *       with_value: unknown,
 *     }
 * >}
 */
function createStateMachineJobMap(ordered_jobs) {
  return new Map(ordered_jobs.map((job) => [job.job_name, job]));
}

/**
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @returns {Record<string, { outputs: Record<string, unknown> }>}
 */
function createStateMachineJobsContext(job_outputs) {
  /** @type {Record<string, { outputs: Record<string, unknown> }>} */
  const jobs_context = {};

  for (const [job_name, output_record] of Object.entries(job_outputs)) {
    jobs_context[job_name] = {
      outputs: output_record,
    };
  }

  return jobs_context;
}

/**
 * @param {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }} worker_result
 * @param {string} error_message
 * @returns {{
 *   outcome: 'failure',
 *   worker_error: string,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }}
 */
function createStateMachineFailureWorkerResult(worker_result, error_message) {
  return {
    ...worker_result,
    outcome: 'failure',
    worker_error: error_message,
  };
}

/**
 * @param {number} exit_code
 * @param {{ stderr?: string, stdout?: string }} exec_result
 * @param {('stderr' | 'stdout')[] | undefined} capture
 * @returns {Record<string, unknown>}
 */
function createCoreRunResult(exit_code, exec_result, capture) {
  /** @type {Record<string, unknown>} */
  const result = {
    exit_code,
  };

  if (capture?.includes('stdout')) {
    result.stdout = exec_result.stdout ?? '';
  }

  if (capture?.includes('stderr')) {
    result.stderr = exec_result.stderr ?? '';
  }

  return result;
}

/**
 * @returns {{ failure: string, success: string }}
 */
/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizeStateMachineResultValue(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }

  if (value === undefined) {
    return {};
  }

  return {
    value,
  };
}

/**
 * @param {unknown} error
 * @returns {error is Error & { code?: number, stderr?: string, stdout?: string }}
 */
function isExecError(error) {
  return error instanceof Error;
}

/**
 * @param {{ id: string, path: string, status: string } | undefined} document
 * @param {{ id: string, path: string, status: string }} task
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createPluginBindingTargets(document, task) {
  /** @type {{
   *   document?: { id: string, path: string, status: string },
   *   task: { id: string, path: string, status: string },
   * }} */
  const binding_targets = {
    task,
  };

  if (document !== undefined) {
    binding_targets.document = document;
  }

  return binding_targets;
}

/**
 * @param {{
 *   next_step_index?: number,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 * }} runtime_record_context
 * @param {{
 *   next_step_index?: number,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 * }} attempt_context
 * @returns {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >}
 */
/**
 * @param {string} repo_directory
 * @param {{
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   ordered_step: { kind: 'uses', step_name: string, with_value?: unknown },
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     run_id?: string,
 *   },
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed' | 'pending-approval',
 *   result: unknown,
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 * }>}
 */
async function executePluginStep(repo_directory, options) {
  const plugin_result = await loadStepPlugin(
    repo_directory,
    options.ordered_step.step_name,
  );
  const run_id = readRequiredRunId(options.runtime_record_context.run_id);
  const binding_targets = readBindingTargets(
    options.runtime_record_context.binding_targets,
  );
  const signal_subjects = readSignalSubjects(binding_targets);
  const runtime_signals = [...options.runtime_signals];
  let approval = options.runtime_record_context.approval;
  let did_complete_on_emit = false;
  let is_waiting_for_approval = false;
  let plugin_result_value;
  const emit_signal =
    /**
     * @param {string} signal_kind
     * @param {unknown} payload
     * @returns {Promise<void>}
     */
    async (signal_kind, payload) => {
      const signal_schema = plugin_result.plugin.emits[signal_kind];

      if (signal_schema === undefined) {
        throw new Error(
          `Plugin "${options.ordered_step.step_name}" cannot emit undeclared signal "${signal_kind}".`,
        );
      }

      const parsed_payload = signal_schema.parse(payload);
      const emitted_at = options.now().toISOString();

      for (const subject of signal_subjects) {
        runtime_signals.push({
          emitted_at,
          kind: signal_kind,
          payload: parsed_payload,
          run_id,
          subject,
        });
      }

      did_complete_on_emit = true;
      throw new PluginStepCompletedSignal();
    };
  const request_approval = async () => {
    if (approval?.approved_at !== undefined && approval.approved_at !== null) {
      return;
    }

    approval = {
      approved_at: null,
      requested_at: approval?.requested_at ?? options.now().toISOString(),
    };
    is_waiting_for_approval = true;
    writeApprovalInstruction(
      resolveOperatorIo(options.operator_io).stdout,
      run_id,
    );
    throw new PluginStepPendingApprovalSignal();
  };

  try {
    plugin_result_value = await plugin_result.plugin.run({
      console: createPluginConsole(resolveOperatorIo(options.operator_io)),
      document: binding_targets.document,
      emit: emit_signal,
      repo_directory,
      requestApproval: request_approval,
      run_id,
      task: binding_targets.task,
      with: options.ordered_step.with_value,
      worktree_path: options.worktree_path,
    });
  } catch (error) {
    if (did_complete_on_emit && error instanceof PluginStepCompletedSignal) {
      return {
        approval,
        outcome: 'completed',
        result: {},
        runtime_signals,
      };
    }

    if (
      is_waiting_for_approval &&
      error instanceof PluginStepPendingApprovalSignal
    ) {
      return {
        approval,
        outcome: 'pending-approval',
        result: {},
        runtime_signals,
      };
    }

    throw error;
  }

  return {
    approval,
    outcome: 'completed',
    result: plugin_result_value,
    runtime_signals,
  };
}

class PluginStepCompletedSignal extends Error {}
class PluginStepPendingApprovalSignal extends Error {}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * } | undefined} binding_targets
 * @returns {('document' | 'task')[]}
 */
function readSignalSubjects(binding_targets) {
  /** @type {('document' | 'task')[]} */
  const signal_subjects = [];

  if (binding_targets?.document !== undefined) {
    signal_subjects.push('document');
  }

  if (binding_targets?.task !== undefined) {
    signal_subjects.push('task');
  }

  /* istanbul ignore next -- state-machine attempts require a task binding before plugin execution can run */
  if (signal_subjects.length === 0) {
    throw new Error(
      'Expected plugin signal subjects to come from run bindings.',
    );
  }

  return signal_subjects;
}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * } | undefined} binding_targets
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }}
 */
function readBindingTargets(binding_targets) {
  if (binding_targets?.task === undefined) {
    throw new Error('Expected plugin execution to have a bound task context.');
  }

  return binding_targets;
}

/**
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }}
 */
function resolveOperatorIo(operator_io) {
  if (operator_io !== undefined) {
    return operator_io;
  }

  return NOOP_OPERATOR_IO;
}

/**
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @returns {{
 *   error: (...values: unknown[]) => void,
 *   info: (...values: unknown[]) => void,
 *   log: (...values: unknown[]) => void,
 *   warn: (...values: unknown[]) => void,
 * }}
 */
function createPluginConsole(operator_io) {
  return {
    error(...values) {
      operator_io.stderr.write(`${formatConsoleMessage(values)}\n`);
    },
    info(...values) {
      operator_io.stdout.write(`${formatConsoleMessage(values)}\n`);
    },
    log(...values) {
      operator_io.stdout.write(`${formatConsoleMessage(values)}\n`);
    },
    warn(...values) {
      operator_io.stderr.write(`${formatConsoleMessage(values)}\n`);
    },
  };
}

/**
 * @param {{ write(chunk: string): boolean }} stdout
 * @param {string} run_id
 * @returns {void}
 */
function writeApprovalInstruction(stdout, run_id) {
  stdout.write(
    `Approval requested. Run \`pravaha approve --token ${run_id}\` to continue.\n`,
  );
}

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function formatConsoleMessage(values) {
  return values.map((value) => formatConsoleValue(value)).join(' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatConsoleValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

/**
 * @param {string | undefined} run_id
 * @returns {string}
 */
function readRequiredRunId(run_id) {
  if (typeof run_id !== 'string' || run_id.trim() === '') {
    throw new Error('Expected a stable run id for plugin execution.');
  }

  return run_id;
}

/**
 * @param {string | null} worker_thread_id
 * @returns {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }}
 */
function createEmptyWorkerResult(worker_thread_id) {
  return {
    outcome: 'success',
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id,
    worker_usage: null,
  };
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}

/**
 * @param {string} task_id
 * @param {string} task_path
 * @returns {{
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createDefaultBindingTargets(task_id, task_path) {
  return {
    task: {
      id: `task:${task_id}`,
      path: task_path,
      status: 'ready',
    },
  };
}
