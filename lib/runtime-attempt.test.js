// @module-tag lint-staged-excluded

/** @import { BuildGraphResult, QueryGraphApi } from './patram-types.ts' */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Codex } from '@openai/codex-sdk';
import { queryGraph } from 'patram';
import { expect, it } from 'vitest';

import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import {
  createMixedRuntimeGraph,
  evaluateMixedGraphQuery,
} from './mixed-graph-runtime.js';
import { createSuccessRunResult } from './run-happy-path.assertions-test-helpers.js';
import { runTaskAttempt } from './runtime-attempt.js';

const run_query_graph = /** @type {QueryGraphApi['query_graph']} */ (
  queryGraph
);

it('uses the default Codex client, default clock, and optional decision paths', async () => {
  const original_start_thread = Codex.prototype.startThread;
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {string | null} */
  let received_prompt = null;

  Codex.prototype.startThread =
    /** @type {typeof Codex.prototype.startThread} */ (
      /** @type {any} */ (
        function startThread() {
          return {
            id: 'thread-default',
            /**
             * @param {string} prompt
             */
            async run(prompt) {
              received_prompt = prompt;

              return createSuccessRunResult();
            },
          };
        }
      )
    );

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createRunTaskAttemptOptions(),
    );

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
      worker_thread_id: 'thread-default',
    });
    expect(received_prompt).not.toContain('Decision document');
  } finally {
    Codex.prototype.startThread = original_start_thread;
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('persists an unresolved local outcome before the worker completes', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await assertObservedRuntimeLifecycle(temp_directory);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('uses default transition projection rules when the worker fails', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const task_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createRunTaskAttemptOptions({
        worker_client: {
          startThread() {
            return {
              id: 'thread-failure',
              async run() {
                throw new Error('worker boom');
              },
            };
          },
        },
      }),
    );
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result).toMatchObject({
      outcome: 'failure',
      worker_error: 'worker boom',
      worker_thread_id: 'thread-failure',
    });
    expect(runtime_record).toMatchObject({
      local_outcome: {
        state: 'failure',
      },
    });
    await expect(readFile(task_path, 'utf8')).resolves.toContain(
      'Status: blocked',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @param {{
 *   observe_runtime_record: (runtime_record: Record<string, unknown>) => void,
 * }} options
 * @returns {Promise<Awaited<ReturnType<typeof runTaskAttempt>>>}
 */
async function runObservedTaskAttempt(temp_directory, options) {
  return runTaskAttempt(
    temp_directory,
    createRunTaskAttemptOptions({
      now: () => new Date('2026-03-25T11:00:00.000Z'),
      worker_client: createObservedRuntimeWorkerClient(
        temp_directory,
        options.observe_runtime_record,
      ),
    }),
  );
}

/**
 * @param {{
 *   now?: () => Date,
 *   worker_client?: {
 *     startThread: () => {
 *       id: string,
 *       run: () => Promise<{
 *         finalResponse: string,
 *         items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *         usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 *       }>,
 *     },
 *   },
 * }} [options]
 * @returns {Parameters<typeof runTaskAttempt>[1]}
 */
function createRunTaskAttemptOptions(options = {}) {
  return {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    now: options.now,
    ordered_steps: [
      {
        kind: 'uses',
        step_name: 'core/lease-task',
      },
      {
        kind: 'uses',
        step_name: 'core/setup-worktree',
      },
      {
        kind: 'uses',
        step_name: 'core/codex-sdk',
      },
    ],
    runtime_label: 'Pravaha single-task flow reconciler slice',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worktree_policy: {
      mode: 'ephemeral',
    },
    worker_client: options.worker_client,
  };
}

/**
 * @param {string} temp_directory
 * @param {(runtime_record: Record<string, unknown>) => void} observe_runtime_record
 * @returns {{
 *   startThread: () => {
 *     id: string,
 *     run: () => Promise<{
 *       finalResponse: string,
 *       items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *       usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 *     }>,
 *   },
 * }}
 */
function createObservedRuntimeWorkerClient(
  temp_directory,
  observe_runtime_record,
) {
  return {
    startThread() {
      return {
        id: 'thread-unresolved',
        async run() {
          observe_runtime_record(
            JSON.parse(
              await readFile(
                join(
                  temp_directory,
                  '.pravaha/runtime/implement-runtime-slice.json',
                ),
                'utf8',
              ),
            ),
          );

          return createSuccessRunResult();
        },
      };
    },
  };
}

/**
 * @param {Record<string, unknown> | null} runtime_record
 * @returns {BuildGraphResult}
 */
function createRuntimeGraph(runtime_record) {
  if (runtime_record === null) {
    throw new Error('Expected an observed runtime record.');
  }

  return createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: {
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      flow_id: FLOW_PATH,
      runtime_records: [runtime_record],
    },
  );
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function assertObservedRuntimeLifecycle(temp_directory) {
  /** @type {Record<string, unknown> | null} */
  let observed_runtime_record = null;
  const run_result = await runObservedTaskAttempt(temp_directory, {
    observe_runtime_record(runtime_record) {
      observed_runtime_record = runtime_record;
    },
  });
  const final_runtime_record = JSON.parse(
    await readFile(run_result.runtime_record_path, 'utf8'),
  );

  expectRuntimeRecordState(observed_runtime_record, 'unresolved');
  assertRuntimeLifecycleQueries(createRuntimeGraph(final_runtime_record), {
    completed: true,
    running_worker: false,
    terminal_signal: true,
  });
  expect(final_runtime_record).toMatchObject({
    local_outcome: {
      completed_at: '2026-03-25T11:00:00.000Z',
      state: 'success',
    },
    selected_task: {
      id: 'implement-runtime-slice',
    },
    worker: {
      thread_id: 'thread-unresolved',
    },
  });
}

/**
 * @param {Record<string, unknown> | null} observed_runtime_record
 * @param {'unresolved'} local_outcome_state
 * @returns {void}
 */
function expectRuntimeRecordState(
  observed_runtime_record,
  local_outcome_state,
) {
  expect(observed_runtime_record).toMatchObject({
    local_outcome: {
      state: local_outcome_state,
    },
    worker: {
      thread_id: 'thread-unresolved',
    },
  });
  assertRuntimeLifecycleQueries(createRuntimeGraph(observed_runtime_record), {
    completed: false,
    running_worker: true,
    terminal_signal: false,
  });
}

/**
 * @param {BuildGraphResult} runtime_graph
 * @param {{
 *   completed: boolean,
 *   running_worker: boolean,
 *   terminal_signal: boolean,
 * }} expectations
 * @returns {void}
 */
function assertRuntimeLifecycleQueries(runtime_graph, expectations) {
  expect(
    queryRuntimeGraph(runtime_graph, '$class == $worker and state == running'),
  ).toBe(expectations.running_worker);
  expect(
    queryRuntimeGraph(
      runtime_graph,
      '$class == $signal and kind == worker_completed and outcome == success',
    ),
  ).toBe(expectations.terminal_signal);
  expect(
    queryRuntimeGraph(
      runtime_graph,
      '$class == $flow_instance and state == completed',
    ),
  ).toBe(expectations.completed);
  expect(queryRuntimeGraph(runtime_graph, '$class == $lease')).toBe(
    expectations.running_worker,
  );
}

/**
 * @param {BuildGraphResult} runtime_graph
 * @param {string} query_text
 * @returns {boolean}
 */
function queryRuntimeGraph(runtime_graph, query_text) {
  return evaluateMixedGraphQuery(
    runtime_graph,
    {
      query_graph: run_query_graph,
    },
    query_text,
    {},
    [],
  );
}
