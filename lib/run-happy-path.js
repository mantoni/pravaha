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
  ACTIVE_DECISION_PATH,
  selectActiveContract,
  selectReadyTask,
} from './run-happy-path-files.js';
import { loadSupportedJob } from './reconcile-flow.js';
import { runTaskAttempt } from './runtime-attempt.js';

export { runHappyPath };
/**
 * @param {string} repo_directory
 * @param {{ now?: () => Date, worker_client?: HappyPathWorkerClient }} [options]
 * @returns {Promise<HappyPathRunResult>}
 */
async function runHappyPath(repo_directory, options = {}) {
  const active_contract = await selectActiveContract(repo_directory);
  const interpreted_job = await loadSupportedJob(
    repo_directory,
    active_contract.root_flow_path,
  );
  const ready_task = await selectReadyTask(repo_directory);

  return /** @type {Promise<HappyPathRunResult>} */ (
    runTaskAttempt(repo_directory, {
      await_query: interpreted_job.await_query,
      contract_path: active_contract.contract_path,
      decision_paths: [ACTIVE_DECISION_PATH],
      flow_path: active_contract.root_flow_path,
      now: options.now,
      ordered_steps: interpreted_job.ordered_steps,
      runtime_label: 'Pravaha Codex SDK happy-path runtime slice',
      task_id: ready_task.task_id,
      task_path: ready_task.task_path,
      transition_conditions: interpreted_job.transition_conditions,
      transition_target_bindings: interpreted_job.transition_target_bindings,
      transition_targets: interpreted_job.transition_targets,
      worktree_policy: interpreted_job.worktree_policy,
      worker_client: options.worker_client,
    })
  );
}
