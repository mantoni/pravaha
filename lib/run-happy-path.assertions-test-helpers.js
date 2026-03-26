/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
import { access, readFile } from 'node:fs/promises';

import { expect } from 'vitest';
import { execGitFile } from './git-process.js';

export {
  assertPreparedWorktree,
  assertSuccessfulRun,
  createSuccessRunResult,
  createSuccessWorkerHarness,
};

/**
 * @returns {{
 *   worker_client: {
 *     startThread: (thread_options?: $12$openai$l$codex$j$sdk.ThreadOptions) => {
 *       id: string,
 *       run: (prompt: string) => Promise<{
 *         finalResponse: string,
 *         items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *         usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 *       }>,
 *     },
 *   },
 *   received_prompt: () => string | null,
 *   received_thread_options: () => $12$openai$l$codex$j$sdk.ThreadOptions | null | undefined,
 * }}
 */
function createSuccessWorkerHarness() {
  /** @type {$12$openai$l$codex$j$sdk.ThreadOptions | null | undefined} */
  let received_thread_options = null;
  /** @type {string | null} */
  let received_prompt = null;

  return {
    worker_client: {
      startThread(thread_options) {
        received_thread_options = thread_options;

        return {
          id: 'thread-success',
          async run(prompt) {
            received_prompt = prompt;

            return createSuccessRunResult();
          },
        };
      },
    },
    received_prompt() {
      return received_prompt;
    },
    received_thread_options() {
      return received_thread_options;
    },
  };
}

/**
 * @param {{
 *   outcome: 'success' | 'failure',
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} run_result
 * @param {{
 *   received_prompt: () => string | null,
 *   received_thread_options: () => $12$openai$l$codex$j$sdk.ThreadOptions | null | undefined,
 * }} worker_harness
 * @returns {Promise<void>}
 */
async function assertSuccessfulRun(run_result, worker_harness) {
  expect(run_result).toMatchObject({
    outcome: 'success',
    task_id: 'implement-runtime-slice',
    worker_thread_id: 'thread-success',
  });
  expect(worker_harness.received_thread_options()).toMatchObject({
    approvalPolicy: 'never',
    modelReasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    workingDirectory: run_result.worktree_path,
  });
  expect(worker_harness.received_prompt()).toContain(
    'docs/tasks/runtime/implement-runtime-slice.md',
  );
  expect(worker_harness.received_prompt()).toContain(
    'docs/contracts/runtime/codex-sdk-happy-path.md',
  );
  expect(worker_harness.received_prompt()).toContain(
    'docs/decisions/runtime/codex-sdk-happy-path-backend.md',
  );
  expect(worker_harness.received_prompt()).toContain(
    'docs/flows/runtime/codex-sdk-happy-path.md',
  );

  await assertSuccessfulProjection(run_result);
  await assertPreparedWorktree(run_result.worktree_path);
}

/**
 * @returns {{
 *   finalResponse: string,
 *   items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *   usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 * }}
 */
function createSuccessRunResult() {
  return {
    finalResponse: JSON.stringify({
      summary: 'Observed the ready task and reported completion.',
    }),
    items: [
      {
        id: 'message-1',
        text: 'Observed the ready task and reported completion.',
        type: 'agent_message',
      },
    ],
    usage: {
      cached_input_tokens: 0,
      input_tokens: 120,
      output_tokens: 40,
    },
  };
}

/**
 * @param {{
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 * }} run_result
 * @returns {Promise<void>}
 */
async function assertSuccessfulProjection(run_result) {
  const task_text = await readFile(run_result.task_path, 'utf8');
  const runtime_record = JSON.parse(
    await readFile(run_result.runtime_record_path, 'utf8'),
  );

  expect(task_text).toContain('Status: review');
  expect(runtime_record).toMatchObject({
    local_outcome: {
      state: 'success',
    },
    selected_task: {
      id: run_result.task_id,
    },
    worker: {
      final_response: JSON.stringify({
        summary: 'Observed the ready task and reported completion.',
      }),
      thread_id: 'thread-success',
    },
  });
}

/**
 * @param {string} worktree_path
 * @returns {Promise<void>}
 */
async function assertPreparedWorktree(worktree_path) {
  expect(worktree_path).toContain(
    '/.pravaha/worktrees/ephemeral-implement-runtime-slice-',
  );
  await expect(access(worktree_path)).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(
    execGitFile(['-C', worktree_path, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }),
  ).rejects.toThrow();
}
