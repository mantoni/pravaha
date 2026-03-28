import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createRuntimeRecord } from '../../runtime-record-model.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../runtime-attempt.state-machine-test-helpers.js';
import { resumeTaskAttempt } from './state-machine.js';

it('falls back to startThread when a resumed state-machine attempt has no worker thread id', async () => {
  const temp_directory = await createResumeFixtureRepo();
  /** @type {string[]} */
  const started_threads = [];
  /** @type {string[]} */
  const resumed_threads = [];

  await expect(
    resumeTaskAttempt(temp_directory, {
      runtime_record: createResumeRuntimeRecord(temp_directory),
      runtime_record_path: join(temp_directory, '.pravaha/runtime/demo.json'),
      worker_client: createResumeWorkerClient(started_threads, resumed_threads),
    }),
  ).resolves.toMatchObject({
    outcome: 'success',
  });

  expect(started_threads).toEqual(['started']);
  expect(resumed_threads).toEqual([]);
});

/** @returns {Promise<string>} */
async function createResumeFixtureRepo() {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Resume.',
    '    next: done',
    '  done:',
    '    end: success',
  ]);
}

/**
 * @param {string} temp_directory
 * @returns {ReturnType<typeof createRuntimeRecord>}
 */
function createResumeRuntimeRecord(temp_directory) {
  return createRuntimeRecord({
    binding_targets: {
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/job-state-machine-execution.md',
    current_job_name: 'implement',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: {},
    leased_at: '2026-03-28T10:00:00.000Z',
    outcome: null,
    prompt: 'prompt',
    run_id: 'run:implement-runtime-slice:2026-03-28T10:00:00.000Z',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_identity: 'worktree-1',
    worktree_mode: 'pooled',
    worktree_path: temp_directory,
  });
}

/**
 * @param {string[]} started_threads
 * @param {string[]} resumed_threads
 * @returns {{
 *   resumeThread: (thread_id: string) => {
 *     id: string,
 *     run: (input: string, turn_options?: unknown) => Promise<{
 *       finalResponse: string,
 *       id: string,
 *       itemCount: number,
 *       items: never[],
 *       usage: null,
 *     }>,
 *   },
 *   startThread: () => {
 *     id: null,
 *     run: (input: string, turn_options?: unknown) => Promise<{
 *       finalResponse: string,
 *       id: null,
 *       itemCount: number,
 *       items: never[],
 *       usage: null,
 *     }>,
 *   },
 * }}
 */
function createResumeWorkerClient(started_threads, resumed_threads) {
  return {
    /**
     * @param {string} thread_id
     */
    resumeThread(thread_id) {
      resumed_threads.push(thread_id);

      return {
        id: thread_id,
        async run() {
          return {
            finalResponse: 'unused',
            id: thread_id,
            itemCount: 0,
            items: [],
            usage: null,
          };
        },
      };
    },
    startThread() {
      started_threads.push('started');

      return {
        id: null,
        async run() {
          return {
            finalResponse: 'completed',
            id: null,
            itemCount: 0,
            items: [],
            usage: null,
          };
        },
      };
    },
  };
}
