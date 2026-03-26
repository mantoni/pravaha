/* eslint-disable complexity, max-lines, max-lines-per-function */
/** @import { RunResult, ThreadOptions, TurnOptions, Usage } from '@openai/codex-sdk' */
/** @import { BuildGraphResult, QueryGraphApi } from './patram-types.ts' */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Codex } from '@openai/codex-sdk';

import { resolveQueryGraph } from './mixed-graph-runtime.js';
import { loadStepPlugin } from './plugin-loader.js';
import { observeWorkerRun } from './run-happy-path-worker.js';
import { projectTaskOutcome } from './runtime-attempt-support.js';
import {
  createResumeAttemptContext,
  createTaskAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';

const exec_file = promisify(execFile);

export { resumeTaskAttempt, runTaskAttempt };

/**
 * @param {string} repo_directory
 * @param {{
 *   await_query?: string,
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   durable_graph?: BuildGraphResult,
 *   decision_paths?: string[],
 *   flow_path: string,
 *   flow_id?: string,
 *   graph_api?: QueryGraphApi,
 *   now?: () => Date,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   relation_names?: string[],
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worktree_policy: { mode: 'ephemeral' } | { mode: 'named', slot: string },
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
  const graph_api = resolveQueryGraph(options.graph_api);
  const binding_targets =
    options.binding_targets ??
    createDefaultBindingTargets(options.task_id, options.task_path);
  const attempt_context = await createTaskAttemptContext(
    repo_directory,
    options,
    now,
  );

  return executeTaskAttempt(repo_directory, {
    attempt_context,
    durable_graph: options.durable_graph ?? createEmptyGraph(),
    flow_id: options.flow_id ?? options.flow_path,
    graph_api,
    now,
    relation_names: options.relation_names ?? [],
    runtime_record_context: {
      await_query: options.await_query,
      binding_targets,
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      ordered_steps: options.ordered_steps,
      run_id: attempt_context.run_id,
      signals: [],
      task_id: options.task_id,
      task_path: options.task_path,
      transition_conditions: options.transition_conditions,
      transition_target_bindings: options.transition_target_bindings,
      transition_targets: options.transition_targets,
    },
    worker_client,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   durable_graph?: BuildGraphResult,
 *   graph_api?: QueryGraphApi,
 *   now?: () => Date,
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
  const graph_api = resolveQueryGraph(options.graph_api);
  const attempt_context = createResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );

  return executeTaskAttempt(repo_directory, {
    attempt_context,
    durable_graph: options.durable_graph ?? createEmptyGraph(),
    flow_id: attempt_context.flow_path,
    graph_api,
    now,
    relation_names: options.relation_names ?? [],
    runtime_record_context: attempt_context,
    worker_client,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   attempt_context: {
 *     next_step_index?: number,
 *     ordered_steps?: Array<
 *       | { command_text: string, kind: 'run' }
 *       | { kind: 'uses', step_name: string, with_value?: unknown }
 *     >,
 *     prompt: string,
 *     runtime_record_path: string,
 *     started_at?: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   durable_graph: BuildGraphResult,
 *   flow_id: string,
 *   graph_api: QueryGraphApi,
 *   now: () => Date,
 *   relation_names: string[],
 *   runtime_record_context: {
 *     await_query?: string,
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     contract_path: string,
 *     flow_path: string,
 *     leased_at?: string,
 *     next_step_index?: number,
 *     ordered_steps?: Array<
 *       | { command_text: string, kind: 'run' }
 *       | { kind: 'uses', step_name: string, with_value?: unknown }
 *     >,
 *     run_id?: string,
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
 *     transition_targets: { failure: string, success: string },
 *     worker_thread_id?: string | null,
 *   },
 *   worker_client: {
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
async function executeTaskAttempt(repo_directory, options) {
  const ordered_steps = readOrderedSteps(
    options.runtime_record_context,
    options.attempt_context,
  );
  const start_step_index = Math.max(
    0,
    options.attempt_context.next_step_index ??
      options.runtime_record_context.next_step_index ??
      0,
  );
  let worker_result = createEmptyWorkerResult(
    options.runtime_record_context.worker_thread_id ?? null,
  );
  /** @type {Array<{
   *   emitted_at: string,
   *   kind: string,
   *   payload: Record<string, unknown>,
   *   run_id?: string,
   *   subject: 'document' | 'task',
   * }>} */
  let runtime_signals = options.runtime_record_context.signals ?? [];

  for (
    let step_index = start_step_index;
    step_index < ordered_steps.length;
    step_index += 1
  ) {
    const ordered_step = ordered_steps[step_index];

    await writeUnresolvedRuntimeRecord(
      createRuntimeRecordContext(
        options.runtime_record_context,
        ordered_steps,
        step_index,
        runtime_signals,
      ),
      createAttemptContext(options.attempt_context, ordered_steps, step_index),
      worker_result.worker_thread_id,
    );

    if (ordered_step.kind === 'run') {
      try {
        await executeRunStep(
          ordered_step.command_text,
          options.attempt_context.worktree_path,
        );
      } catch (error) {
        return finalizeTaskAttempt(repo_directory, {
          attempt_context: options.attempt_context,
          durable_graph: options.durable_graph,
          flow_id: options.flow_id,
          graph_api: options.graph_api,
          now: options.now,
          ordered_steps,
          outcome: 'failure',
          relation_names: options.relation_names,
          runtime_record_context: options.runtime_record_context,
          should_project_outcome: false,
          task_error: formatRunStepFailure(ordered_step.command_text, error),
          worker_result,
          runtime_signals,
        });
      }
    } else if (isWorkerStep(ordered_step)) {
      worker_result = await observeWorkerRun(
        options.worker_client,
        options.attempt_context.worktree_path,
        options.attempt_context.prompt,
        {
          on_thread_opened(worker_thread_id) {
            worker_result = {
              ...worker_result,
              worker_thread_id,
            };

            return writeUnresolvedRuntimeRecord(
              createRuntimeRecordContext(
                options.runtime_record_context,
                ordered_steps,
                step_index,
                runtime_signals,
              ),
              createAttemptContext(
                options.attempt_context,
                ordered_steps,
                step_index,
              ),
              worker_thread_id,
            ).then(() => undefined);
          },
          worker_thread_id: worker_result.worker_thread_id,
        },
      );

      if (worker_result.outcome === 'failure') {
        return finalizeTaskAttempt(repo_directory, {
          attempt_context: options.attempt_context,
          durable_graph: options.durable_graph,
          flow_id: options.flow_id,
          graph_api: options.graph_api,
          now: options.now,
          ordered_steps,
          outcome: 'failure',
          relation_names: options.relation_names,
          runtime_record_context: options.runtime_record_context,
          should_project_outcome: true,
          task_error: worker_result.worker_error,
          worker_result,
          runtime_signals,
        });
      }
    } else {
      try {
        runtime_signals = await executePluginStep(repo_directory, {
          now: options.now,
          ordered_step,
          runtime_record_context: options.runtime_record_context,
          runtime_signals,
          worktree_path: options.attempt_context.worktree_path,
        });
      } catch (error) {
        return finalizeTaskAttempt(repo_directory, {
          attempt_context: options.attempt_context,
          durable_graph: options.durable_graph,
          flow_id: options.flow_id,
          graph_api: options.graph_api,
          now: options.now,
          ordered_steps,
          outcome: 'failure',
          relation_names: options.relation_names,
          runtime_record_context: options.runtime_record_context,
          should_project_outcome: false,
          task_error: formatUsesStepFailure(ordered_step.step_name, error),
          worker_result,
          runtime_signals,
        });
      }
    }

    await writeUnresolvedRuntimeRecord(
      createRuntimeRecordContext(
        options.runtime_record_context,
        ordered_steps,
        step_index + 1,
        runtime_signals,
      ),
      createAttemptContext(
        options.attempt_context,
        ordered_steps,
        step_index + 1,
      ),
      worker_result.worker_thread_id,
    );
  }

  return finalizeTaskAttempt(repo_directory, {
    attempt_context: options.attempt_context,
    durable_graph: options.durable_graph,
    flow_id: options.flow_id,
    graph_api: options.graph_api,
    now: options.now,
    ordered_steps,
    outcome: 'success',
    relation_names: options.relation_names,
    runtime_record_context: options.runtime_record_context,
    should_project_outcome: true,
    task_error: null,
    worker_result,
    runtime_signals,
  });
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
 *       mode: 'ephemeral' | 'named',
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
 *     transition_targets: { failure: string, success: string },
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
async function finalizeTaskAttempt(repo_directory, options) {
  const final_worker_result = {
    ...options.worker_result,
    outcome: options.outcome,
    worker_error: options.task_error ?? options.worker_result.worker_error,
  };
  const final_runtime_record = await writeFinalRuntimeRecord(
    createRuntimeRecordContext(
      options.runtime_record_context,
      options.ordered_steps,
      options.ordered_steps.length,
      options.runtime_signals,
    ),
    createAttemptContext(
      options.attempt_context,
      options.ordered_steps,
      options.ordered_steps.length,
    ),
    final_worker_result,
    options.now,
  );

  if (options.should_project_outcome) {
    await projectTaskOutcome(repo_directory, {
      await_query:
        options.runtime_record_context.await_query ??
        '$class == $signal and kind == worker_completed and subject == task',
      binding_targets:
        options.runtime_record_context.binding_targets ??
        createDefaultBindingTargets(
          options.runtime_record_context.task_id,
          options.runtime_record_context.task_path,
        ),
      durable_graph: options.durable_graph,
      flow_id: options.flow_id,
      graph_api: options.graph_api,
      relation_names: options.relation_names,
      runtime_records: [final_runtime_record],
      transition_conditions:
        options.runtime_record_context.transition_conditions ??
        createDefaultTransitionConditions(),
      transition_target_bindings:
        options.runtime_record_context.transition_target_bindings ??
        createDefaultTransitionBindings(),
      transition_targets: options.runtime_record_context.transition_targets,
    });
  }

  return createRunResult(repo_directory, {
    contract_path: options.runtime_record_context.contract_path,
    flow_path: options.runtime_record_context.flow_path,
    outcome: options.outcome,
    prompt: options.attempt_context.prompt,
    runtime_record_path: options.attempt_context.runtime_record_path,
    task_id: options.runtime_record_context.task_id,
    task_path: options.runtime_record_context.task_path,
    worker_result: final_worker_result,
    worktree_path: options.attempt_context.worktree_path,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   outcome: 'failure' | 'success',
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
 *     mode: 'ephemeral' | 'named',
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
 *     mode: 'ephemeral' | 'named',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }}
 */
function createAttemptContext(attempt_context, ordered_steps, next_step_index) {
  return {
    ...attempt_context,
    next_step_index,
    ordered_steps,
  };
}

/**
 * @param {{
 *   await_query?: string,
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at?: string,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   signals?: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     subject: 'document' | 'task',
 *   }>,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 * }} runtime_record_context
 * @param {Array<
 *   | { command_text: string, kind: 'run' }
 *   | { kind: 'uses', step_name: string, with_value?: unknown }
 * >} ordered_steps
 * @param {number} next_step_index
 * @param {Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   subject: 'document' | 'task',
 * }>} runtime_signals
 * @returns {{
 *   await_query?: string,
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at?: string,
 *   next_step_index: number,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     subject: 'document' | 'task',
 *   }>,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 * }}
 */
function createRuntimeRecordContext(
  runtime_record_context,
  ordered_steps,
  next_step_index,
  runtime_signals,
) {
  return {
    ...runtime_record_context,
    next_step_index,
    ordered_steps,
    signals: runtime_signals,
  };
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
function readOrderedSteps(runtime_record_context, attempt_context) {
  const ordered_steps =
    runtime_record_context.ordered_steps ?? attempt_context.ordered_steps;

  if (Array.isArray(ordered_steps)) {
    return ordered_steps;
  }

  return [];
}

/**
 * @param {string} command_text
 * @param {string} worktree_path
 * @returns {Promise<void>}
 */
async function executeRunStep(command_text, worktree_path) {
  await exec_file('/bin/zsh', ['-lc', command_text], {
    cwd: worktree_path,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   now: () => Date,
 *   ordered_step: { kind: 'uses', step_name: string, with_value?: unknown },
 *   runtime_record_context: {
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     run_id?: string,
 *     task_id: string,
 *     task_path: string,
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
 * @returns {Promise<Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * }>>}
 */
async function executePluginStep(repo_directory, options) {
  const plugin_result = await loadStepPlugin(
    repo_directory,
    options.ordered_step.step_name,
  );
  const run_id = readRequiredRunId(options.runtime_record_context.run_id);
  const signal_subjects = readSignalSubjects(
    options.runtime_record_context.binding_targets,
  );
  const runtime_signals = [...options.runtime_signals];
  let did_complete_on_emit = false;
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

  try {
    await plugin_result.plugin.run({
      emit: emit_signal,
      binding_targets: options.runtime_record_context.binding_targets,
      repo_directory,
      run_id,
      step_name: options.ordered_step.step_name,
      task: {
        id: options.runtime_record_context.task_id,
        path: options.runtime_record_context.task_path,
      },
      with: options.ordered_step.with_value,
      worktree_path: options.worktree_path,
    });
  } catch (error) {
    if (did_complete_on_emit && error instanceof PluginStepCompletedSignal) {
      return runtime_signals;
    }

    throw error;
  }

  return runtime_signals;
}

/**
 * @param {{
 *   kind: 'run',
 * } | {
 *   kind: 'uses',
 *   step_name: string,
 *   with_value?: unknown,
 * }} ordered_step
 * @returns {boolean}
 */
function isWorkerStep(ordered_step) {
  return (
    ordered_step.kind === 'uses' && ordered_step.step_name === 'core/codex-sdk'
  );
}

class PluginStepCompletedSignal extends Error {}

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

  if (signal_subjects.length === 0) {
    throw new Error(
      'Expected plugin signal subjects to come from run bindings.',
    );
  }

  return signal_subjects;
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
 * @param {string} command_text
 * @param {unknown} error
 * @returns {string}
 */
function formatRunStepFailure(command_text, error) {
  const error_message = error instanceof Error ? error.message : String(error);

  return `Run step failed (${command_text}): ${error_message}`;
}

/**
 * @param {string} step_name
 * @param {unknown} error
 * @returns {string}
 */
function formatUsesStepFailure(step_name, error) {
  const error_message = error instanceof Error ? error.message : String(error);

  return `Uses step failed (${step_name}): ${error_message}`;
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}

/**
 * @returns {BuildGraphResult}
 */
function createEmptyGraph() {
  return {
    edges: [],
    nodes: {},
  };
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

/**
 * @returns {{ failure: string, success: string }}
 */
function createDefaultTransitionConditions() {
  return {
    failure:
      '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
    success:
      '$class == $signal and kind == worker_completed and subject == task and outcome == success',
  };
}

/**
 * @returns {{ failure: string, success: string }}
 */
function createDefaultTransitionBindings() {
  return {
    failure: 'task',
    success: 'task',
  };
}
