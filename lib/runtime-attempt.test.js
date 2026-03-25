import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Codex } from '@openai/codex-sdk';
import { expect, it } from 'vitest';

import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { createSuccessRunResult } from './run-happy-path.assertions-test-helpers.js';
import { runTaskAttempt } from './runtime-attempt.js';

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
    const run_result = await runTaskAttempt(temp_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'Pravaha single-task flow reconciler slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
    });

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
  /** @type {Record<string, unknown> | null} */
  let observed_runtime_record = null;

  try {
    const run_result = await runObservedTaskAttempt(temp_directory, {
      observe_runtime_record(runtime_record) {
        observed_runtime_record = runtime_record;
      },
    });
    const final_runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(observed_runtime_record).toMatchObject({
      local_outcome: {
        state: 'unresolved',
      },
      worker: {
        thread_id: 'thread-unresolved',
      },
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
  return runTaskAttempt(temp_directory, {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    now: () => new Date('2026-03-25T11:00:00.000Z'),
    runtime_label: 'Pravaha single-task flow reconciler slice',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker_client: createObservedRuntimeWorkerClient(
      temp_directory,
      options.observe_runtime_record,
    ),
  });
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
