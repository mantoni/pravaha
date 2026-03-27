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
  cleanupWorkspace,
  RUNTIME_DIRECTORY,
  prepareWorkspace,
  writeRuntimeRecord,
} from './runtime-files.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createRuntimeRecord,
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordCurrentJobName,
  getRuntimeRecordFlowPath,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordJobOutputs,
  getRuntimeRecordJobVisitCounts,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordPrompt,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
} from './runtime-record-model.js';

export {
  createStateMachineAttemptContext,
  createStateMachineResumeAttemptContext,
  cleanupStateMachineAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
};

/**
 * @typedef {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   contract_path: string,
 *   current_job_name?: string,
 *   flow_path: string,
 *   format_version?: 'state-machine-v2',
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   leased_at?: string,
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 * }} RuntimeRecordContext
 */

/**
 * @typedef {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   contract_path?: string,
 *   prompt: string,
 *   runtime_record_path: string,
 *   current_job_name?: string,
 *   flow_path?: string,
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   leased_at?: string,
 *   started_at?: string,
 *   run_id?: string,
 *   task_id?: string,
 *   task_path?: string,
 *   worker_thread_id?: string | null,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
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
 *   runtime_label: string,
 *   start_job_name: string,
 *   task_id: string,
 *   task_path: string,
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
 * @param {() => Date} now
 * @returns {Promise<AttemptContext>}
 */
async function createStateMachineAttemptContext(repo_directory, options, now) {
  const started_at = now().toISOString();
  const worktree_assignment = await prepareWorkspace(
    repo_directory,
    options.task_id,
    options.workspace,
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
    current_job_name: options.start_job_name,
    job_outputs: {},
    job_visit_counts: {},
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
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {AttemptContext & {
 *   contract_path: string,
 *   current_job_name: string,
 *   flow_path: string,
 *   leased_at: string,
 *   prompt: string,
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 * }}
 */
function createStateMachineResumeAttemptContext(
  repo_directory,
  runtime_record,
  runtime_record_path,
) {
  const format_version = getRuntimeRecordFormatVersion(runtime_record);

  if (format_version !== 'state-machine-v2') {
    throw new Error(
      `Legacy unresolved runtime record ${runtime_record_path} is incompatible with the job state-machine engine. Clear local runtime state before continuing.`,
    );
  }

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
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const current_job_name = readRequiredString(
    getRuntimeRecordCurrentJobName(runtime_record),
    `Expected ${runtime_record_path} to record a current job name.`,
  );

  if (binding_targets === null) {
    throw new Error(
      `Expected ${runtime_record_path} to record binding targets.`,
    );
  }

  return {
    approval: getRuntimeRecordApproval(runtime_record) ?? undefined,
    binding_targets: normalizeBindingTargets(repo_directory, binding_targets),
    contract_path: normalizeRepoPath(repo_directory, contract_path),
    current_job_name,
    flow_path: normalizeRepoPath(repo_directory, flow_path),
    job_outputs: getRuntimeRecordJobOutputs(runtime_record),
    job_visit_counts: getRuntimeRecordJobVisitCounts(runtime_record),
    leased_at,
    prompt,
    run_id,
    runtime_record_path,
    task_id,
    task_path: normalizeRepoPath(repo_directory, task_path),
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
    approval: runtime_record_context.approval,
    binding_targets: runtime_record_context.binding_targets,
    contract_path: runtime_record_context.contract_path,
    current_job_name:
      runtime_record_context.current_job_name ??
      attempt_context.current_job_name,
    format_version:
      runtime_record_context.format_version ??
      (attempt_context.current_job_name === undefined
        ? undefined
        : 'state-machine-v2'),
    job_outputs:
      runtime_record_context.job_outputs ?? attempt_context.job_outputs,
    job_visit_counts:
      runtime_record_context.job_visit_counts ??
      attempt_context.job_visit_counts,
    flow_path: runtime_record_context.flow_path,
    leased_at,
    outcome: null,
    prompt: attempt_context.prompt,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
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
    approval: runtime_record_context.approval,
    binding_targets: runtime_record_context.binding_targets,
    completed_at: now().toISOString(),
    contract_path: runtime_record_context.contract_path,
    current_job_name:
      runtime_record_context.current_job_name ??
      attempt_context.current_job_name,
    format_version:
      runtime_record_context.format_version ??
      (attempt_context.current_job_name === undefined
        ? undefined
        : 'state-machine-v2'),
    job_outputs:
      runtime_record_context.job_outputs ?? attempt_context.job_outputs,
    job_visit_counts:
      runtime_record_context.job_visit_counts ??
      attempt_context.job_visit_counts,
    flow_path: runtime_record_context.flow_path,
    leased_at,
    outcome: worker_result.outcome,
    prompt: attempt_context.prompt,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
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
 * @param {AttemptContext} attempt_context
 * @returns {Promise<void>}
 */
async function cleanupStateMachineAttemptContext(attempt_context) {
  if (
    attempt_context.worktree_assignment.mode === 'named' ||
    attempt_context.worktree_assignment.mode === 'pooled'
  ) {
    return;
  }

  await cleanupWorkspace(
    /** @type {any} */ (attempt_context.worktree_assignment),
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
 * @param {'ephemeral' | 'named' | 'pooled' | null} value
 * @param {string} runtime_record_path
 * @returns {'ephemeral' | 'named' | 'pooled'}
 */
function readRequiredWorktreeMode(value, runtime_record_path) {
  if (value === 'ephemeral' || value === 'named' || value === 'pooled') {
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
 * @param {Record<
 *   string,
 *   { id: string, path: string, status: string } | undefined
 * >} binding_targets
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function normalizeBindingTargets(repo_directory, binding_targets) {
  /** @type {Record<string, { id: string, path: string, status: string }>} */
  const normalized_targets = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    if (binding_target === undefined) {
      continue;
    }

    normalized_targets[binding_name] = {
      ...binding_target,
      path: normalizeRepoPath(repo_directory, binding_target.path),
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
