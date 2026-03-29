import { renderStateMachineValue } from './state-machine-runtime.js';
import { executePluginStep } from './plugin-step.js';
import {
  createEmptyWorkerResult,
  normalizeStateMachineResultValue,
} from './result.js';
import { createPluginBindingTargets } from './state-machine-context.js';

export { executeStateMachineAction };

/**
 * @param {string} repo_directory
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
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
 *     worker_usage: null,
 *   },
 * }>}
 */
async function executeStateMachineAction(repo_directory, options) {
  const rendered_with_value = renderStateMachineValue(options.with_value, {
    document: options.document,
    jobs: options.jobs_context,
    result: {},
    task: options.task,
  });
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
    worktree_path: options.worktree_path,
  });

  return {
    approval: plugin_result.approval,
    outcome: plugin_result.outcome,
    result: normalizeStateMachineResultValue(plugin_result.result),
    worker_result: createEmptyWorkerResult(options.worker_thread_id),
  };
}
