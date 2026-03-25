/** @import { HappyPathRunResult, HappyPathWorkerClient } from './run-happy-path.types.ts' */
import {
  ACTIVE_DECISION_PATH,
  selectActiveContract,
  selectReadyTask,
} from './run-happy-path-files.js';
import { runTaskAttempt } from './runtime-attempt.js';

export { runHappyPath };
/**
 * @param {string} repo_directory
 * @param {{ now?: () => Date, worker_client?: HappyPathWorkerClient }} [options]
 * @returns {Promise<HappyPathRunResult>}
 */
async function runHappyPath(repo_directory, options = {}) {
  const active_contract = await selectActiveContract(repo_directory);
  const ready_task = await selectReadyTask(repo_directory);

  return /** @type {Promise<HappyPathRunResult>} */ (
    runTaskAttempt(repo_directory, {
      contract_path: active_contract.contract_path,
      decision_paths: [ACTIVE_DECISION_PATH],
      flow_path: active_contract.root_flow_path,
      now: options.now,
      runtime_label: 'Pravaha Codex SDK happy-path runtime slice',
      task_id: ready_task.task_id,
      task_path: ready_task.task_path,
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worker_client: options.worker_client,
    })
  );
}
