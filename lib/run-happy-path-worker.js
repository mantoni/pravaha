/** @import { RunResult, ThreadOptions, TurnOptions, Usage } from '@openai/codex-sdk' */

const WORKER_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
    },
  },
  required: ['summary'],
  type: 'object',
};

export { observeWorkerRun };

/**
 * @param {{
 *   startThread: (thread_options?: ThreadOptions) => {
 *     id: string | null,
 *     run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 *   },
 * }} worker_client
 * @param {string} worktree_path
 * @param {string} prompt
 * @returns {Promise<{
 *   outcome: 'success' | 'failure',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }>}
 */
async function observeWorkerRun(worker_client, worktree_path, prompt) {
  const thread = worker_client.startThread({
    approvalPolicy: 'never',
    modelReasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    workingDirectory: worktree_path,
  });

  try {
    const run_result = await thread.run(prompt, {
      outputSchema: WORKER_OUTPUT_SCHEMA,
    });

    return createWorkerSuccess(thread.id, run_result);
  } catch (error) {
    return createWorkerFailure(thread.id, error);
  }
}

/**
 * @param {string | null} worker_thread_id
 * @param {RunResult} run_result
 * @returns {{
 *   outcome: 'success',
 *   worker_error: null,
 *   worker_final_response: string,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 * }}
 */
function createWorkerSuccess(worker_thread_id, run_result) {
  return {
    outcome: 'success',
    worker_error: null,
    worker_final_response: run_result.finalResponse,
    worker_item_count: run_result.items.length,
    worker_thread_id,
    worker_usage: run_result.usage,
  };
}

/**
 * @param {string | null} worker_thread_id
 * @param {unknown} error
 * @returns {{
 *   outcome: 'failure',
 *   worker_error: string,
 *   worker_final_response: null,
 *   worker_item_count: 0,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
 * }}
 */
function createWorkerFailure(worker_thread_id, error) {
  return {
    outcome: 'failure',
    worker_error: getErrorMessage(error),
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id,
    worker_usage: null,
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
