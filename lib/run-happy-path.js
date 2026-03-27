/**
 * Hard-coded Codex SDK happy-path runtime entrypoint.
 *
 * Decided by: ../docs/decisions/runtime/codex-sdk-happy-path-backend.md
 * Decided by: ../docs/decisions/runtime/trigger-driven-codex-runtime.md
 * Implements: ../docs/contracts/runtime/codex-sdk-happy-path.md
 * @patram
 */
/** @import { HappyPathRunResult, HappyPathWorkerClient } from './run-happy-path.types.ts' */
import {
  selectActiveContract,
  selectReadyTask,
} from './run-happy-path-files.js';
import { loadStateMachineFlow } from './reconcile-flow.js';
import { runStateMachineAttempt } from './runtime-attempt.js';

export { runHappyPath };
/**
 * @param {string} repo_directory
 * @param {{
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   worker_client?: HappyPathWorkerClient,
 * }} [options]
 * @returns {Promise<HappyPathRunResult>}
 */
async function runHappyPath(repo_directory, options = {}) {
  const active_contract = await selectActiveContract(repo_directory);
  const flow = await loadStateMachineFlow(
    repo_directory,
    active_contract.root_flow_path,
  );
  const ready_task = await selectReadyTask(repo_directory);

  return /** @type {Promise<HappyPathRunResult>} */ (
    runStateMachineAttempt(repo_directory, {
      binding_targets: {
        task: {
          id: `task:${ready_task.task_id}`,
          path: ready_task.task_path,
          status: 'ready',
        },
      },
      contract_path: active_contract.contract_path,
      flow_path: active_contract.root_flow_path,
      now: options.now,
      operator_io: options.operator_io,
      ordered_jobs: flow.ordered_jobs,
      runtime_label: 'Pravaha Codex SDK happy-path runtime slice',
      start_job_name: flow.start_job_name,
      task_id: ready_task.task_id,
      task_path: ready_task.task_path,
      worker_client: options.worker_client,
      workspace: flow.workspace,
    })
  );
}
