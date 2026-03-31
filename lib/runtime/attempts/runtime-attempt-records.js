/* eslint-disable max-lines */
/**
 * Runtime attempt persistence and resume context assembly.
 *
 * Decided by: ../../../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Decided by: ../../../docs/decisions/runtime/approval-only-command-ingress.md
 * Implements: ../../../docs/contracts/runtime/local-dispatch-runtime.md
 * Implements: ../../../docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
 * @patram
 */
import { join } from 'node:path';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import {
  cleanupWorkspace,
  createConcreteWorkspaceDefinition,
  createEphemeralWorkspacePath,
  RUNTIME_DIRECTORY,
  prepareWorkspace,
  resolveConfiguredWorkspacePaths,
  writeRuntimeRecord,
} from '../workspaces/runtime-files.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createRuntimeRecord,
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordCurrentHandlerName,
  getRuntimeRecordFlowInstanceId,
  getRuntimeRecordInput,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordFlowPath,
  getRuntimeRecordFlowState,
  getRuntimeRecordFlowWaitState,
  getRuntimeRecordQueueWait,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
} from '../records/runtime-record-model.js';

export {
  cleanupAttemptContext,
  createFlowAttemptContext,
  createFlowResumeAttemptContext,
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
 *   current_handler_name?: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state?: Record<string, unknown>,
 *   format_version?: 'javascript-flow-v1',
 *   input?: {
 *     kind: 'prompt',
 *     prompt: string,
 *   },
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
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
 *   flow_instance_id?: string,
 *   input?: {
 *     kind: 'prompt',
 *     prompt: string,
 *   },
 *   runtime_record_path: string,
 *   flow_path?: string,
 *   prompt: string,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id?: string,
 *   task_id?: string,
 *   task_path?: string,
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
 * @typedef {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   input?: {
 *     kind: 'prompt',
 *     prompt: string,
 *   },
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   recorded_worktree?: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 * }} DurableAttemptContext
 */

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   decision_paths?: string[],
 *   flow_path: string,
 *   flow_instance_id?: string,
 *   input?: {
 *     kind: 'prompt',
 *     prompt: string,
 *   },
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 *   workspace: (
 *     | { id: string }
 *     | {
 *         id: string,
 *         location: {
 *           path: string,
 *         },
 *         mode: 'ephemeral' | 'pooled',
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *   ),
 * }} options
 * @param {() => Date} now
 * @returns {Promise<AttemptContext>}
 */
async function createFlowAttemptContext(repo_directory, options, now) {
  const started_at = now().toISOString();
  const run_id = createRunId(options.task_id, started_at);
  const workspace_definition = await resolveAttemptWorkspaceDefinition(
    repo_directory,
    options.flow_instance_id ?? options.task_id,
    options.workspace,
  );
  const worktree_assignment = await prepareWorkspace(
    repo_directory,
    workspace_definition,
  );
  const prompt = await createRuntimePrompt(repo_directory, {
    contract_path: options.contract_path,
    decision_paths: options.decision_paths ?? [],
    flow_path: options.flow_path,
    runtime_label: options.runtime_label,
    task_path: options.task_path,
  });

  return {
    input: options.input,
    prompt,
    run_id,
    runtime_record_path: join(
      repo_directory,
      RUNTIME_DIRECTORY,
      `${options.task_id}.json`,
    ),
    worktree_assignment,
    worktree_path: worktree_assignment.path,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} flow_instance_id
 * @param {(
 *   | { id: string }
 *   | {
 *       id: string,
 *       location: {
 *         path: string,
 *       },
 *       mode: 'ephemeral' | 'pooled',
 *       ref: string,
 *       source: {
 *         kind: 'repo',
 *       },
 *     }
 * )} workspace
 * @returns {Promise<{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral' | 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }>}
 */
// eslint-disable-next-line complexity
async function resolveAttemptWorkspaceDefinition(
  repo_directory,
  flow_instance_id,
  workspace,
) {
  if (
    'location' in workspace &&
    typeof workspace.location?.path === 'string' &&
    (workspace.mode === 'ephemeral' || workspace.mode === 'pooled') &&
    typeof workspace.ref === 'string'
  ) {
    return workspace;
  }

  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(
      pravaha_config_result.diagnostics
        .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
        .join('\n'),
    );
  }

  const workspace_definition =
    pravaha_config_result.config.workspace_config[workspace.id];

  if (workspace_definition === undefined) {
    throw new Error(
      `Flow workspace.id "${workspace.id}" is not defined in pravaha.config.js workspaces.`,
    );
  }

  if (workspace_definition.mode === 'pooled') {
    const [workspace_path] = resolveConfiguredWorkspacePaths(
      repo_directory,
      workspace.id,
      pravaha_config_result.config.workspace_config,
    );

    if (typeof workspace_path !== 'string') {
      throw new Error(
        `Expected pooled workspace "${workspace.id}" to define at least one path.`,
      );
    }

    return createConcreteWorkspaceDefinition(
      workspace.id,
      workspace_definition,
      workspace_path,
    );
  }

  return createConcreteWorkspaceDefinition(
    workspace.id,
    workspace_definition,
    createEphemeralWorkspacePath(
      repo_directory,
      workspace.id,
      pravaha_config_result.config.workspace_config,
      flow_instance_id,
    ),
  );
}

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {DurableAttemptContext & {
 *   current_handler_name: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }}
 */
function createFlowResumeAttemptContext(
  repo_directory,
  runtime_record,
  runtime_record_path,
) {
  const format_version = getRuntimeRecordFormatVersion(runtime_record);

  if (format_version !== 'javascript-flow-v1') {
    throw new Error(
      `Legacy unresolved runtime record ${runtime_record_path} is incompatible with the JavaScript flow runtime. Clear local runtime state before continuing.`,
    );
  }

  const required_fields = readRequiredResumeFields(
    runtime_record,
    runtime_record_path,
  );
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record) ?? {};
  const current_handler_name = readRequiredString(
    getRuntimeRecordCurrentHandlerName(runtime_record),
    `Expected ${runtime_record_path} to record a current handler name.`,
  );

  const recorded_worktree = readRecordedWorktree(
    repo_directory,
    runtime_record,
  );

  return {
    approval: getRuntimeRecordApproval(runtime_record) ?? undefined,
    binding_targets: normalizeBindingTargets(repo_directory, binding_targets),
    contract_path: normalizeRepoPath(
      repo_directory,
      required_fields.contract_path,
    ),
    current_handler_name,
    flow_instance_id: required_fields.flow_instance_id,
    flow_path: normalizeRepoPath(repo_directory, required_fields.flow_path),
    flow_state: getRuntimeRecordFlowState(runtime_record),
    input: getRuntimeRecordInput(runtime_record) ?? undefined,
    queue_wait: getRuntimeRecordQueueWait(runtime_record) ?? undefined,
    recorded_worktree,
    run_id: required_fields.run_id,
    runtime_record_path,
    task_id: required_fields.task_id,
    task_path: normalizeRepoPath(repo_directory, required_fields.task_path),
    wait_state: getRuntimeRecordFlowWaitState(runtime_record) ?? undefined,
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
  void worker_thread_id;

  const runtime_record = createRuntimeRecord({
    approval: runtime_record_context.approval,
    binding_targets: runtime_record_context.binding_targets,
    contract_path: runtime_record_context.contract_path,
    current_handler_name: runtime_record_context.current_handler_name,
    flow_instance_id: runtime_record_context.flow_instance_id,
    flow_state: runtime_record_context.flow_state,
    format_version:
      runtime_record_context.format_version ?? 'javascript-flow-v1',
    input: runtime_record_context.input,
    queue_wait: runtime_record_context.queue_wait ?? attempt_context.queue_wait,
    flow_path: runtime_record_context.flow_path,
    outcome: null,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
    wait_state: runtime_record_context.wait_state,
    worktree_identity: attempt_context.worktree_assignment.identity,
    worktree_mode: attempt_context.worktree_assignment.mode,
    worktree_path: attempt_context.worktree_assignment.path,
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
 *   worker_usage: null,
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
  const runtime_record = createRuntimeRecord({
    approval: runtime_record_context.approval,
    binding_targets: runtime_record_context.binding_targets,
    completed_at: now().toISOString(),
    contract_path: runtime_record_context.contract_path,
    current_handler_name: runtime_record_context.current_handler_name,
    flow_instance_id: runtime_record_context.flow_instance_id,
    flow_state: runtime_record_context.flow_state,
    format_version:
      runtime_record_context.format_version ?? 'javascript-flow-v1',
    input: runtime_record_context.input,
    queue_wait: runtime_record_context.queue_wait ?? attempt_context.queue_wait,
    flow_path: runtime_record_context.flow_path,
    outcome: worker_result.outcome,
    run_id: runtime_record_context.run_id ?? attempt_context.run_id,
    task_id: runtime_record_context.task_id,
    task_path: runtime_record_context.task_path,
    wait_state: runtime_record_context.wait_state,
    worktree_identity: attempt_context.worktree_assignment.identity,
    worktree_mode: attempt_context.worktree_assignment.mode,
    worktree_path: attempt_context.worktree_assignment.path,
    worktree_slot: attempt_context.worktree_assignment.slot,
  });

  await writeRuntimeRecord(attempt_context.runtime_record_path, runtime_record);

  return runtime_record;
}

/**
 * @param {AttemptContext} attempt_context
 * @returns {Promise<void>}
 */
async function cleanupAttemptContext(attempt_context) {
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
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {{
 *   contract_path: string,
 *   flow_instance_id: string,
 *   flow_path: string,
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 * }}
 */
function readRequiredResumeFields(runtime_record, runtime_record_path) {
  return {
    contract_path: readRequiredString(
      getRuntimeRecordContractPath(runtime_record),
      `Expected ${runtime_record_path} to record a contract path.`,
    ),
    flow_instance_id: readRequiredString(
      getRuntimeRecordFlowInstanceId(runtime_record),
      `Expected ${runtime_record_path} to record a flow-instance id.`,
    ),
    flow_path: readRequiredString(
      getRuntimeRecordFlowPath(runtime_record),
      `Expected ${runtime_record_path} to record a flow path.`,
    ),
    run_id: readRequiredString(
      getRuntimeRecordRunId(runtime_record),
      `Expected ${runtime_record_path} to record a run id.`,
    ),
    task_id: readRequiredString(
      getRuntimeRecordSelectedTaskId(runtime_record),
      `Expected ${runtime_record_path} to record a selected task id.`,
    ),
    task_path: readRequiredString(
      getRuntimeRecordSelectedTaskPath(runtime_record),
      `Expected ${runtime_record_path} to record a selected task path.`,
    ),
  };
}

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @returns {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named' | 'pooled',
 *   path: string,
 *   slot?: string,
 * } | undefined}
 */
function readRecordedWorktree(repo_directory, runtime_record) {
  const worktree_identity = getRuntimeRecordWorktreeIdentity(runtime_record);
  const worktree_mode = getRuntimeRecordWorktreeMode(runtime_record);
  const worktree_path = getRuntimeRecordWorktreePath(runtime_record);

  if (
    typeof worktree_identity !== 'string' ||
    (worktree_mode !== 'ephemeral' &&
      worktree_mode !== 'named' &&
      worktree_mode !== 'pooled')
  ) {
    return undefined;
  }

  const worktree_slot = getRuntimeRecordWorktreeSlot(runtime_record);
  /** @type {{
   *   identity: string,
   *   mode: 'ephemeral' | 'named' | 'pooled',
   *   path: string,
   *   slot?: string,
   * }} */
  const recorded_worktree = {
    identity: worktree_identity,
    mode: worktree_mode,
    path:
      typeof worktree_path === 'string'
        ? worktree_path
        : join(repo_directory, '.pravaha/worktrees', worktree_identity),
  };

  if (typeof worktree_slot === 'string') {
    recorded_worktree.slot = worktree_slot;
  }

  return recorded_worktree;
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
 * @param {string} started_at
 * @returns {string}
 */
function createRunId(task_id, started_at) {
  return `run:${task_id}:${started_at}`;
}
