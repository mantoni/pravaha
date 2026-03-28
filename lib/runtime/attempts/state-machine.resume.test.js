import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createRuntimeRecord } from '../../runtime-record-model.js';
import { CONTRACT_PATH } from '../../reconcile.fixture-test-helpers.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../runtime-attempt.state-machine-test-helpers.js';
import { resumeTaskAttempt } from './state-machine.js';

it('starts a fresh worker thread when resuming from a durable checkpoint', async () => {
  const temp_directory = await createResumeFixtureRepo();
  /** @type {string[]} */
  const started_threads = [];
  /** @type {string[]} */
  const resumed_threads = [];

  await expect(
    resumeTaskAttempt(temp_directory, {
      runtime_record: createResumeRuntimeRecord(),
      runtime_record_path: join(temp_directory, '.pravaha/runtime/demo.json'),
      worker_client: createResumeWorkerClient(started_threads, resumed_threads),
    }),
  ).resolves.toMatchObject({
    outcome: 'success',
  });

  expect(started_threads).toEqual(['started']);
  expect(resumed_threads).toEqual([]);
});

it('recreates missing resume checkpoint maps as empty execution state', async () => {
  const temp_directory = await createResumeFixtureRepo();
  const runtime_record =
    /** @type {ReturnType<typeof createResumeRuntimeRecord> & {
     *   job_state?: {
     *     job_outputs?: Record<string, Record<string, unknown>>,
     *     job_visit_counts?: Record<string, number>,
     *   },
     * }} */ (createResumeRuntimeRecord());

  if (runtime_record.job_state !== undefined) {
    delete runtime_record.job_state.job_outputs;
    delete runtime_record.job_state.job_visit_counts;
  }

  await expect(
    resumeTaskAttempt(temp_directory, {
      runtime_record,
      runtime_record_path: join(temp_directory, '.pravaha/runtime/demo.json'),
      worker_client: createResumeWorkerClient([], []),
    }),
  ).resolves.toMatchObject({
    outcome: 'success',
  });
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
 * @returns {ReturnType<typeof createRuntimeRecord>}
 */
function createResumeRuntimeRecord() {
  return createRuntimeRecord({
    binding_targets: {
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_job_name: 'implement',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: {},
    outcome: null,
    run_id: 'run:implement-runtime-slice:2026-03-28T10:00:00.000Z',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
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
