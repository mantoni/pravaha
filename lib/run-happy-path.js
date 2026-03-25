/** @import { HappyPathRunResult, HappyPathWorkerClient, HappyPathWorkerResult, RunContext, RuntimeRecord, RuntimeRecordOptions } from './run-happy-path.types.ts' */
import { join } from 'node:path';
import { Codex } from '@openai/codex-sdk';
import {
  ACTIVE_CONTRACT_PATH,
  ACTIVE_FLOW_PATH,
  RUNTIME_DIRECTORY,
  createDeterministicPrompt,
  prepareWorktree,
  selectActiveContract,
  selectReadyTask,
  updateDocumentStatus,
  writeRuntimeRecord,
} from './run-happy-path-files.js';
import { observeWorkerRun } from './run-happy-path-worker.js';
export { runHappyPath };
/**
 * @param {string} repo_directory
 * @param {{ now?: () => Date, worker_client?: HappyPathWorkerClient }} [options]
 * @returns {Promise<HappyPathRunResult>}
 */
async function runHappyPath(repo_directory, options = {}) {
  const now = options.now ?? createCurrentDate;
  const worker_client = options.worker_client ?? new Codex();
  const run_context = await initializeHappyPathRun(repo_directory, now);
  const initial_record = createRuntimeRecord({
    contract_path: run_context.active_contract.contract_path,
    flow_path: run_context.active_contract.root_flow_path,
    leased_at: run_context.started_at,
    outcome: null,
    prompt: run_context.prompt,
    task_id: run_context.ready_task.task_id,
    task_path: run_context.ready_task.task_path,
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_path: run_context.worktree_path,
  });
  await writeRuntimeRecord(run_context.runtime_record_path, initial_record);
  const worker_result = await observeWorkerRun(
    worker_client,
    run_context.worktree_path,
    run_context.prompt,
  );
  await projectTaskOutcome(
    repo_directory,
    run_context.ready_task.task_path,
    worker_result.outcome,
  );
  await writeRuntimeRecord(
    run_context.runtime_record_path,
    createRuntimeRecord({
      completed_at: now().toISOString(),
      contract_path: run_context.active_contract.contract_path,
      flow_path: run_context.active_contract.root_flow_path,
      leased_at: run_context.started_at,
      outcome: worker_result.outcome,
      prompt: run_context.prompt,
      task_id: run_context.ready_task.task_id,
      task_path: run_context.ready_task.task_path,
      worker_error: worker_result.worker_error,
      worker_final_response: worker_result.worker_final_response,
      worker_item_count: worker_result.worker_item_count,
      worker_thread_id: worker_result.worker_thread_id,
      worker_usage: worker_result.worker_usage,
      worktree_path: run_context.worktree_path,
    }),
  );

  return createRunResult(
    repo_directory,
    run_context.runtime_record_path,
    run_context.ready_task,
    worker_result,
    run_context.worktree_path,
    run_context.prompt,
  );
}

/**
 * @param {string} repo_directory
 * @param {string} task_path
 * @param {'success' | 'failure'} outcome
 * @returns {Promise<void>}
 */
async function projectTaskOutcome(repo_directory, task_path, outcome) {
  const next_status = outcome === 'success' ? 'review' : 'blocked';

  await updateDocumentStatus(
    join(repo_directory, task_path),
    'ready',
    next_status,
  );
}

/**
 * @param {string} repo_directory
 * @param {() => Date} now
 * @returns {Promise<RunContext>}
 */
async function initializeHappyPathRun(repo_directory, now) {
  const active_contract = await selectActiveContract(repo_directory);
  const ready_task = await selectReadyTask(repo_directory);
  const worktree_path = await prepareWorktree(
    repo_directory,
    ready_task.task_id,
  );
  const prompt = await createDeterministicPrompt(
    repo_directory,
    ready_task.task_path,
  );

  return {
    active_contract,
    prompt,
    ready_task,
    runtime_record_path: join(
      repo_directory,
      RUNTIME_DIRECTORY,
      `${ready_task.task_id}.json`,
    ),
    started_at: now().toISOString(),
    worktree_path,
  };
}

/**
 * @param {RuntimeRecordOptions} options
 * @returns {RuntimeRecord}
 */
function createRuntimeRecord(options) {
  /** @type {RuntimeRecord} */
  const runtime_record = {
    contract_path: options.contract_path,
    flow_path: options.flow_path,
    leased_at: options.leased_at,
    outcome: options.outcome,
    prompt: options.prompt,
    task_id: options.task_id,
    task_path: options.task_path,
    worker: {
      error_message: options.worker_error,
      final_response: options.worker_final_response,
      item_count: options.worker_item_count,
      thread_id: options.worker_thread_id,
      usage: options.worker_usage,
    },
    worktree_path: options.worktree_path,
  };

  if (options.completed_at !== undefined) {
    runtime_record.completed_at = options.completed_at;
  }

  return runtime_record;
}

/**
 * @param {string} repo_directory
 * @param {string} runtime_record_path
 * @param {RunContext['ready_task']} ready_task
 * @param {HappyPathWorkerResult} worker_result
 * @param {string} worktree_path
 * @param {string} prompt
 * @returns {HappyPathRunResult}
 */
function createRunResult(
  repo_directory,
  runtime_record_path,
  ready_task,
  worker_result,
  worktree_path,
  prompt,
) {
  return {
    contract_path: join(repo_directory, ACTIVE_CONTRACT_PATH),
    outcome: worker_result.outcome,
    prompt,
    root_flow_path: join(repo_directory, ACTIVE_FLOW_PATH),
    runtime_record_path,
    task_id: ready_task.task_id,
    task_path: join(repo_directory, ready_task.task_path),
    worker_error: worker_result.worker_error,
    worker_final_response: worker_result.worker_final_response,
    worker_thread_id: worker_result.worker_thread_id,
    worktree_path,
  };
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}
