/* eslint-disable max-lines */
import {
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';
import { selectStateMachineNextTarget } from './state-machine-runtime.js';
import { executeStateMachineAction } from './core-actions.js';
import {
  createEmptyWorkerResult,
  createRunResult,
  createStateMachineFailureWorkerResult,
} from './result.js';
import {
  createStateMachineJobMap,
  createStateMachineJobsContext,
  createStateMachineRuntimeRecordContext,
  createStateMachineWriteAttemptContext,
} from './state-machine-context.js';
import { readBindingTargets } from './plugin-step.js';

export { executeStateMachineAttempt };

/**
 * @typedef {{
 *   end_state: string,
 *   job_name: string,
 *   kind: 'end',
 * }} EndStateMachineJob
 */

/**
 * @typedef {{
 *   job_name: string,
 *   kind: 'action',
 *   limits: { max_visits: number } | null,
 *   next_branches: Array<{
 *     condition_text: string | null,
 *     target_job_name: string,
 *   }>,
 *   uses_value: string,
 *   with_value: unknown,
 * }} ActionStateMachineJob
 */

/**
 * @typedef {EndStateMachineJob | ActionStateMachineJob} StateMachineJob
 */

/**
 * @typedef {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
 * }} StateMachineWorkerResult
 */

/**
 * @typedef {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_job_name: string,
 *   document_context?: { id: string, path: string, status: string },
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   ordered_jobs: Map<string, StateMachineJob>,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   task_context: { id: string, path: string, status: string },
 *   worker_result: StateMachineWorkerResult,
 * }} ExecutionState
 */

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
 *     queue_wait?: {
 *       branch_head: string,
 *       branch_ref: string,
 *       outcome: 'failure' | 'success' | null,
 *       ready_ref: string,
 *       state: 'failed' | 'succeeded' | 'waiting',
 *     },
 *     run_id?: string,
 *     task_id: string,
 *     task_path: string,
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
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
  const execution_state = createExecutionState(options);

  while (true) {
    const current_job = readCurrentJob(execution_state);
    const terminal_result = await readTerminalOutcome(
      repo_directory,
      options,
      execution_state,
      current_job,
    );

    if (terminal_result !== null) {
      return terminal_result;
    }

    if (current_job.kind !== 'action') {
      throw new Error(
        `Expected state-machine job "${execution_state.current_job_name}" to be an action.`,
      );
    }

    await writeCurrentRuntimeRecord(options, execution_state);

    const action_result = await readActionResult(
      repo_directory,
      options,
      execution_state,
      current_job,
    );

    if ('terminal_result' in action_result) {
      return action_result.terminal_result;
    }

    const failed_action_result = await readFailedActionOutcome(
      repo_directory,
      options,
      execution_state,
      action_result,
    );

    if (failed_action_result !== null) {
      return failed_action_result;
    }

    const pending_result = await readPendingOutcome(
      repo_directory,
      options,
      execution_state,
      action_result,
    );

    if (pending_result !== null) {
      return pending_result;
    }

    const next_result = await updateExecutionState(
      repo_directory,
      options,
      execution_state,
      current_job,
      action_result,
    );

    if (next_result !== null) {
      return next_result;
    }
  }
}

/**
 * @param {{
 *   attempt_context: {
 *     prompt: string,
 *     run_id?: string,
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
 *     current_job_name: string,
 *     job_outputs: Record<string, Record<string, unknown>>,
 *     job_visit_counts: Record<string, number>,
 *     queue_wait?: {
 *       branch_head: string,
 *       branch_ref: string,
 *       outcome: 'failure' | 'success' | null,
 *       ready_ref: string,
 *       state: 'failed' | 'succeeded' | 'waiting',
 *     },
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
 * }} options
 * @returns {ExecutionState}
 */
function createExecutionState(options) {
  const binding_targets = readBindingTargets(
    options.runtime_record_context.binding_targets,
  );

  return {
    approval: options.runtime_record_context.approval,
    current_job_name: options.runtime_record_context.current_job_name,
    document_context: binding_targets.document,
    job_outputs: {
      ...options.runtime_record_context.job_outputs,
    },
    job_visit_counts: {
      ...options.runtime_record_context.job_visit_counts,
    },
    ordered_jobs: createStateMachineJobMap(options.ordered_jobs),
    queue_wait: options.runtime_record_context.queue_wait,
    task_context: binding_targets.task,
    worker_result: createEmptyWorkerResult(null),
  };
}

/**
 * @param {ExecutionState} execution_state
 * @returns {StateMachineJob}
 */
function readCurrentJob(execution_state) {
  const current_job = execution_state.ordered_jobs.get(
    execution_state.current_job_name,
  );

  if (current_job === undefined) {
    throw new Error(
      `Unknown state-machine job "${execution_state.current_job_name}".`,
    );
  }

  return current_job;
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {StateMachineJob} current_job
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAttempt>> | null>}
 */
async function readTerminalOutcome(
  repo_directory,
  options,
  execution_state,
  current_job,
) {
  if (current_job.kind === 'end') {
    return finalizeStateMachineAttempt(
      repo_directory,
      options,
      current_job.end_state === 'success' ? 'success' : 'failure',
      current_job.end_state === 'success'
        ? execution_state.worker_result
        : {
            ...execution_state.worker_result,
            outcome: 'failure',
            worker_error:
              execution_state.worker_result.worker_error ??
              `State-machine ended in terminal state "${current_job.end_state}".`,
          },
      execution_state,
    );
  }

  const next_visit_count =
    (execution_state.job_visit_counts[execution_state.current_job_name] ?? 0) +
    1;
  execution_state.job_visit_counts[execution_state.current_job_name] =
    next_visit_count;

  if (
    current_job.limits !== null &&
    next_visit_count > current_job.limits.max_visits
  ) {
    return finalizeStateMachineAttempt(
      repo_directory,
      options,
      'failure',
      createStateMachineFailureWorkerResult(
        execution_state.worker_result,
        `State-machine job "${execution_state.current_job_name}" exceeded max-visits (${current_job.limits.max_visits}).`,
      ),
      execution_state,
    );
  }

  return null;
}

/**
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @returns {Promise<void>}
 */
async function writeCurrentRuntimeRecord(options, execution_state) {
  await writeUnresolvedRuntimeRecord(
    createStateMachineRuntimeRecordContext(
      options.runtime_record_context,
      execution_state.current_job_name,
      execution_state.job_outputs,
      execution_state.job_visit_counts,
      execution_state.approval,
      execution_state.queue_wait,
    ),
    createStateMachineWriteAttemptContext(
      options.attempt_context,
      execution_state.current_job_name,
      execution_state.job_outputs,
      execution_state.job_visit_counts,
    ),
    execution_state.worker_result.worker_thread_id,
  );
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {ActionStateMachineJob} current_job
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAction>>>}
 */
async function executeCurrentJobAction(
  repo_directory,
  options,
  execution_state,
  current_job,
) {
  return executeStateMachineAction(repo_directory, {
    approval: execution_state.approval,
    current_job_name: execution_state.current_job_name,
    document: execution_state.document_context,
    jobs_context: createStateMachineJobsContext(execution_state.job_outputs),
    now: options.now,
    operator_io: options.operator_io,
    queue_wait: execution_state.queue_wait,
    run_id: options.attempt_context.run_id ?? null,
    task: execution_state.task_context,
    uses_value: current_job.uses_value,
    with_value: current_job.with_value,
    worker_thread_id: execution_state.worker_result.worker_thread_id,
    worktree_path: options.attempt_context.worktree_path,
  });
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {ActionStateMachineJob} current_job
 * @returns {Promise<
 *   | Awaited<ReturnType<typeof executeStateMachineAction>>
 *   | {
 *       terminal_result: Awaited<ReturnType<typeof executeStateMachineAttempt>>,
 *     }
 * >}
 */
async function readActionResult(
  repo_directory,
  options,
  execution_state,
  current_job,
) {
  try {
    return await executeCurrentJobAction(
      repo_directory,
      options,
      execution_state,
      current_job,
    );
  } catch (error) {
    return {
      terminal_result: await finalizeStateMachineAttempt(
        repo_directory,
        options,
        'failure',
        createStateMachineFailureWorkerResult(
          execution_state.worker_result,
          readErrorMessage(error),
        ),
        execution_state,
      ),
    };
  }
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {Awaited<ReturnType<typeof executeStateMachineAction>>} action_result
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAttempt>> | null>}
 */
async function readFailedActionOutcome(
  repo_directory,
  options,
  execution_state,
  action_result,
) {
  execution_state.approval = action_result.approval;
  execution_state.queue_wait = action_result.queue_wait;
  execution_state.worker_result = action_result.worker_result;

  if (action_result.outcome !== 'failed') {
    return null;
  }

  return finalizeStateMachineAttempt(
    repo_directory,
    options,
    'failure',
    createStateMachineFailureWorkerResult(
      execution_state.worker_result,
      action_result.failure_message ?? 'State-machine action failed.',
    ),
    execution_state,
  );
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {Awaited<ReturnType<typeof executeStateMachineAction>>} action_result
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAttempt>> | null>}
 */
async function readPendingOutcome(
  repo_directory,
  options,
  execution_state,
  action_result,
) {
  execution_state.approval = action_result.approval;
  execution_state.queue_wait = action_result.queue_wait;
  execution_state.worker_result = action_result.worker_result;

  if (
    action_result.outcome !== 'pending-approval' &&
    action_result.outcome !== 'pending-queue'
  ) {
    return null;
  }

  await writeCurrentRuntimeRecord(options, execution_state);

  return createRunResult(repo_directory, {
    contract_path: options.runtime_record_context.contract_path,
    flow_path: options.runtime_record_context.flow_path,
    outcome: action_result.outcome,
    prompt: options.attempt_context.prompt,
    runtime_record_path: options.attempt_context.runtime_record_path,
    task_id: options.runtime_record_context.task_id,
    task_path: options.runtime_record_context.task_path,
    worker_result: execution_state.worker_result,
    worktree_path: options.attempt_context.worktree_path,
  });
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {ExecutionState} execution_state
 * @param {ActionStateMachineJob} current_job
 * @param {Awaited<ReturnType<typeof executeStateMachineAction>>} action_result
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAttempt>> | null>}
 */
async function updateExecutionState(
  repo_directory,
  options,
  execution_state,
  current_job,
  action_result,
) {
  execution_state.job_outputs[execution_state.current_job_name] =
    action_result.result;
  const next_job_name = selectStateMachineNextTarget(
    current_job.next_branches,
    {
      document: execution_state.document_context,
      jobs: createStateMachineJobsContext(execution_state.job_outputs),
      result: action_result.result,
      task: execution_state.task_context,
    },
  );

  if (next_job_name === null) {
    return finalizeStateMachineAttempt(
      repo_directory,
      options,
      'failure',
      createStateMachineFailureWorkerResult(
        execution_state.worker_result,
        `State-machine job "${execution_state.current_job_name}" did not match any next branch.`,
      ),
      execution_state,
    );
  }

  execution_state.current_job_name = next_job_name;

  return null;
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeStateMachineAttempt>[1]} options
 * @param {'failure' | 'success'} outcome
 * @param {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
 * }} worker_result
 * @param {ExecutionState} execution_state
 * @returns {Promise<Awaited<ReturnType<typeof executeStateMachineAttempt>>>}
 */
async function finalizeStateMachineAttempt(
  repo_directory,
  options,
  outcome,
  worker_result,
  execution_state,
) {
  await writeFinalRuntimeRecord(
    createStateMachineRuntimeRecordContext(
      options.runtime_record_context,
      execution_state.current_job_name,
      execution_state.job_outputs,
      execution_state.job_visit_counts,
      execution_state.approval,
      execution_state.queue_wait,
    ),
    createStateMachineWriteAttemptContext(
      options.attempt_context,
      execution_state.current_job_name,
      execution_state.job_outputs,
      execution_state.job_visit_counts,
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
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
