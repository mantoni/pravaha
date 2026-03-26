/* eslint-disable max-lines, max-lines-per-function */
/**
 * Runtime attempt persistence and resume context assembly.
 *
 * Decided by: ../docs/decisions/runtime/trigger-driven-codex-runtime.md
 * Decided by: ../docs/decisions/runtime/job-and-step-execution-semantics.md
 * Implements: ../docs/contracts/runtime/strict-runtime-resume.md
 * @patram
 */
import { join } from 'node:path';

import {
  RUNTIME_DIRECTORY,
  prepareWorktree,
  writeRuntimeRecord,
} from './runtime-files.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createRuntimeRecord,
  getRuntimeRecordAwaitQuery,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordNextStepIndex,
  getRuntimeRecordOrderedSteps,
  getRuntimeRecordPrompt,
  getRuntimeRecordRunId,
  getRuntimeRecordSignals,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionConditions,
  getRuntimeRecordTransitionTargetBindings,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
} from './runtime-record-model.js';

export {
  createResumeAttemptContext,
  createTaskAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
};

/**
 * @typedef {{
 *   await_query?: string,
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at?: string,
 *   next_step_index?: number,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   run_id?: string,
 *   signals?: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions?: { failure: string, success: string },
 *   transition_target_bindings?: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worktree_policy?: { mode: 'ephemeral' } | { mode: 'named', slot: string },
 * }} RuntimeRecordContext
 */

/**
 * @typedef {{
 *   prompt: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   next_step_index?: number,
 *   ordered_steps?: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   run_id?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }} AttemptContext
 */

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   decision_paths?: string[],
 *   flow_path: string,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 *   worktree_policy: { mode: 'ephemeral' } | { mode: 'named', slot: string },
 * }} options
 * @param {() => Date} now
 * @returns {Promise<AttemptContext>}
 */
async function createTaskAttemptContext(repo_directory, options, now) {
  const started_at = now().toISOString();
  const worktree_policy = readRequiredWorktreePolicy(options.worktree_policy);
  const worktree_assignment = await prepareWorktree(
    repo_directory,
    options.task_id,
    worktree_policy,
    started_at,
  );
  const prompt = await createRuntimePrompt(repo_directory, {
    contract_path: options.contract_path,
    decision_paths: options.decision_paths ?? [],
    flow_path: options.flow_path,
    runtime_label: options.runtime_label,
    task_path: options.task_path,
  });

  return {
    next_step_index: 0,
    ordered_steps: options.ordered_steps,
    prompt,
    run_id: createRunId(options.task_id, started_at),
    runtime_record_path: join(
      repo_directory,
      RUNTIME_DIRECTORY,
      `${options.task_id}.json`,
    ),
    started_at,
    worktree_assignment,
    worktree_path: worktree_assignment.path,
  };
}

/**
 * @param {{ mode: 'ephemeral' } | { mode: 'named', slot: string } | undefined} worktree_policy
 * @returns {{ mode: 'ephemeral' } | { mode: 'named', slot: string }}
 */
function readRequiredWorktreePolicy(worktree_policy) {
  if (worktree_policy?.mode === 'ephemeral') {
    return worktree_policy;
  }

  if (worktree_policy?.mode === 'named') {
    return worktree_policy;
  }

  throw new Error('Expected an explicit worktree policy.');
}

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {{
 *   await_query: string,
 *   binding_targets: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at: string,
 *   next_step_index: number,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string, with_value?: unknown }
 *   >,
 *   run_id: string,
 *   signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 *   prompt: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worker_thread_id: string | null,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }}
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
  const run_id = readRequiredString(
    getRuntimeRecordRunId(runtime_record),
    `Expected ${runtime_record_path} to record a run id.`,
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
  const worktree_mode = readRequiredWorktreeMode(
    getRuntimeRecordWorktreeMode(runtime_record),
    runtime_record_path,
  );
  const worktree_identity = readRequiredString(
    getRuntimeRecordWorktreeIdentity(runtime_record),
    `Expected ${runtime_record_path} to record a worktree identity.`,
  );
  const transition_targets = getRuntimeRecordTransitionTargets(runtime_record);
  const await_query = readRequiredString(
    getRuntimeRecordAwaitQuery(runtime_record),
    `Expected ${runtime_record_path} to record an await query.`,
  );
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const transition_conditions =
    getRuntimeRecordTransitionConditions(runtime_record);
  const transition_target_bindings =
    getRuntimeRecordTransitionTargetBindings(runtime_record);

  if (transition_targets === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record transition targets.`,
    );
  }

  if (binding_targets === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record binding targets.`,
    );
  }

  if (transition_conditions === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record transition conditions.`,
    );
  }

  if (transition_target_bindings === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record transition target bindings.`,
    );
  }

  return {
    await_query,
    binding_targets: normalizeBindingTargets(repo_directory, binding_targets),
    contract_path: normalizeRepoPath(repo_directory, contract_path),
    flow_path: normalizeRepoPath(repo_directory, flow_path),
    leased_at,
    next_step_index: getRuntimeRecordNextStepIndex(runtime_record),
    ordered_steps: getRuntimeRecordOrderedSteps(runtime_record),
    prompt,
    run_id,
    runtime_record_path,
    signals: getRuntimeRecordSignals(runtime_record),
    task_id,
    task_path: normalizeRepoPath(repo_directory, task_path),
    transition_conditions,
    transition_target_bindings,
    transition_targets,
    worker_thread_id: getRuntimeRecordWorkerThreadId(runtime_record),
    worktree_assignment: {
      identity: worktree_identity,
      mode: worktree_mode,
      path: worktree_path,
      slot: getRuntimeRecordWorktreeSlot(runtime_record) ?? undefined,
    },
    worktree_path,
  };
}

/**
 * @param {RuntimeRecordContext} runtime_record_context
 * @param {AttemptContext} attempt_context
 * @param {string | null} worker_thread_id
 * @returns {Promise<Record<string, unknown>>}
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

  const runtime_record = createRuntimeRecord({
    await_query: runtime_record_context.await_query,
    binding_targets: runtime_record_context.binding_targets,
    contract_path: runtime_record_context.contract_path,
    next_step_index:
      runtime_record_context.next_step_index ?? attempt_context.next_step_index,
    ordered_steps:
      runtime_record_context.ordered_steps ?? attempt_context.ordered_steps,
    signals: runtime_record_context.signals,
    flow_path: runtime_record_context.flow_path,
    leased_at,
    outcome: null,
    prompt: attempt_context.prompt,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
    transition_conditions: runtime_record_context.transition_conditions,
    transition_target_bindings:
      runtime_record_context.transition_target_bindings,
    transition_targets: runtime_record_context.transition_targets,
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id,
    worker_usage: null,
    worktree_identity: attempt_context.worktree_assignment.identity,
    worktree_mode: attempt_context.worktree_assignment.mode,
    worktree_path: attempt_context.worktree_path,
    worktree_slot: attempt_context.worktree_assignment.slot,
  });

  await writeRuntimeRecord(attempt_context.runtime_record_path, runtime_record);

  return runtime_record;
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
 * @returns {Promise<Record<string, unknown>>}
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

  const runtime_record = createRuntimeRecord({
    await_query: runtime_record_context.await_query,
    binding_targets: runtime_record_context.binding_targets,
    completed_at: now().toISOString(),
    contract_path: runtime_record_context.contract_path,
    next_step_index:
      runtime_record_context.next_step_index ?? attempt_context.next_step_index,
    ordered_steps:
      runtime_record_context.ordered_steps ?? attempt_context.ordered_steps,
    signals: runtime_record_context.signals,
    flow_path: runtime_record_context.flow_path,
    leased_at,
    outcome: worker_result.outcome,
    prompt: attempt_context.prompt,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
    transition_conditions: runtime_record_context.transition_conditions,
    transition_target_bindings:
      runtime_record_context.transition_target_bindings,
    transition_targets: runtime_record_context.transition_targets,
    worker_error: worker_result.worker_error,
    worker_final_response: worker_result.worker_final_response,
    worker_item_count: worker_result.worker_item_count,
    worker_thread_id: worker_result.worker_thread_id,
    worker_usage: worker_result.worker_usage,
    worktree_identity: attempt_context.worktree_assignment.identity,
    worktree_mode: attempt_context.worktree_assignment.mode,
    worktree_path: attempt_context.worktree_path,
    worktree_slot: attempt_context.worktree_assignment.slot,
  });

  await writeRuntimeRecord(attempt_context.runtime_record_path, runtime_record);

  return runtime_record;
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
 * @param {'ephemeral' | 'named' | null} value
 * @param {string} runtime_record_path
 * @returns {'ephemeral' | 'named'}
 */
function readRequiredWorktreeMode(value, runtime_record_path) {
  if (value === 'ephemeral' || value === 'named') {
    return value;
  }

  throw new Error(
    `Expected ${runtime_record_path} to record a supported worktree mode.`,
  );
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

/**
 * @param {string} repo_directory
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }}
 */
function normalizeBindingTargets(repo_directory, binding_targets) {
  /** @type {{
   *   document?: { id: string, path: string, status: string },
   *   task?: { id: string, path: string, status: string },
   * }} */
  const normalized_targets = {};

  if (binding_targets.document !== undefined) {
    normalized_targets.document = {
      ...binding_targets.document,
      path: normalizeRepoPath(repo_directory, binding_targets.document.path),
    };
  }

  if (binding_targets.task !== undefined) {
    normalized_targets.task = {
      ...binding_targets.task,
      path: normalizeRepoPath(repo_directory, binding_targets.task.path),
    };
  }

  return normalized_targets;
}

/**
 * @param {string} task_id
 * @param {string} leased_at
 * @returns {string}
 */
function createRunId(task_id, leased_at) {
  return `run:${task_id}:${leased_at}`;
}
