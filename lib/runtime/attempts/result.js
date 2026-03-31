import { join } from 'node:path';

export {
  createCurrentDate,
  createDefaultBindingTargets,
  createEmptyWorkerResult,
  createRunResult,
  createStateMachineFailureWorkerResult,
  normalizeStateMachineResultValue,
};

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   flow_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
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
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
 * }} worker_result
 * @param {string} error_message
 * @returns {{
 *   outcome: 'failure',
 *   worker_error: string,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
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
 * @param {string | null} worker_thread_id
 * @returns {{
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: null,
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
 *   doc: { id: string, path: string, status: string },
 * }}
 */
function createDefaultBindingTargets(task_id, task_path) {
  return {
    doc: {
      id: `task:${task_id}`,
      path: task_path,
      status: 'ready',
    },
  };
}
