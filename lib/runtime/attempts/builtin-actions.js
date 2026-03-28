/* eslint-disable max-lines */
/** @import { RunResult, ThreadOptions, TurnOptions, Usage } from '@openai/codex-sdk' */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { execGitFile } from '../../shared/git/exec-git-file.js';
import { observeWorkerRun } from '../../runtime-worker.js';
import { resolveOperatorIo, writeApprovalInstruction } from './plugin-io.js';
import { createCoreRunResult, createEmptyWorkerResult } from './result.js';

const exec_file = promisify(execFile);

export { executeBuiltinAction };

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   base_prompt: string,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   run_id: string | null,
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
 * } | null>}
 */
async function executeBuiltinAction(options, rendered_with_value) {
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
    return executeCoreFlowDispatchAction(options, rendered_with_value);
  }

  return null;
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   base_prompt: string,
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

    return createBuiltinResult(
      options.approval,
      createCoreRunResult(0, result, with_value.capture),
      options.worker_thread_id,
    );
  } catch (error) {
    if (isExecError(error)) {
      return createBuiltinResult(
        options.approval,
        createCoreRunResult(error.code ?? 1, error, with_value.capture),
        options.worker_thread_id,
      );
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

  return createBuiltinResult(
    options.approval,
    {
      verdict: 'approve',
    },
    options.worker_thread_id,
  );
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

  return createBuiltinResult(
    options.approval,
    {
      dirty: status_result.stdout.trim() !== '',
      head: head_result.stdout.trim(),
    },
    options.worker_thread_id,
  );
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   worker_thread_id: string | null,
 * }} options
 * @param {unknown} rendered_with_value
 * @returns {{
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
 * }}
 */
function executeCoreFlowDispatchAction(options, rendered_with_value) {
  const with_value =
    /** @type {{ flow?: string, inputs?: Record<string, unknown>, wait?: boolean }} */ (
      rendered_with_value
    );

  return createBuiltinResult(
    options.approval,
    {
      dispatched: true,
      flow: with_value.flow ?? null,
      inputs: with_value.inputs ?? {},
      wait: with_value.wait ?? false,
    },
    options.worker_thread_id,
  );
}

/**
 * @param {{
 *   approved_at: string | null,
 *   requested_at: string,
 * } | undefined} approval
 * @param {Record<string, unknown>} result
 * @param {string | null} worker_thread_id
 * @returns {{
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
 * }}
 */
function createBuiltinResult(approval, result, worker_thread_id) {
  return {
    approval,
    outcome: 'completed',
    result,
    worker_result: createEmptyWorkerResult(worker_thread_id),
  };
}

/**
 * @param {unknown} error
 * @returns {error is Error & { code?: number, stderr?: string, stdout?: string }}
 */
function isExecError(error) {
  return error instanceof Error;
}
