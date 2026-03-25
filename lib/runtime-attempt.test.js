import { rm } from 'node:fs/promises';

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
