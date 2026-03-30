import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { CONTRACT_PATH } from '../../../test/fixtures/reconcile-fixture.js';
import { installFakeCodexExecutable } from '../../../test/support/runtime.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../../test/support/runtime-attempt-state-machine.js';
import { resumeTaskAttempt } from './state-machine.js';

it('re-runs the current bundled plugin when resuming from a durable checkpoint', async () => {
  const temp_directory = await createResumeFixtureRepo();

  await expect(
    executeResumeAttempt(
      temp_directory,
      createResumeRuntimeRecord(temp_directory),
    ),
  ).resolves.toMatchObject({
    outcome: 'success',
  });
});

it('recreates missing resume checkpoint maps as empty execution state', async () => {
  const temp_directory = await createResumeFixtureRepo();
  const runtime_record =
    /** @type {ReturnType<typeof createResumeRuntimeRecord> & {
     *   job_state?: {
     *     job_outputs?: Record<string, Record<string, unknown>>,
     *     job_visit_counts?: Record<string, number>,
     *   },
     * }} */ (createResumeRuntimeRecord(temp_directory));

  if (runtime_record.job_state !== undefined) {
    delete runtime_record.job_state.job_outputs;
    delete runtime_record.job_state.job_visit_counts;
  }

  await expect(
    executeResumeAttempt(temp_directory, runtime_record),
  ).resolves.toMatchObject({
    outcome: 'success',
  });
});

/** @returns {Promise<string>} */
async function createResumeFixtureRepo() {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Resume.',
    '      reasoning: medium',
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
    contract_path: CONTRACT_PATH,
    current_job_name: 'implement',
    flow_instance_id: 'implement-runtime-slice',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: {},
    outcome: null,
    run_id: 'run:implement-runtime-slice:2026-03-28T10:00:00.000Z',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    worktree_identity: `${temp_directory}/.pravaha/worktrees/implement-runtime-slice`,
    worktree_mode: 'ephemeral',
    worktree_path: `${temp_directory}/.pravaha/worktrees/implement-runtime-slice`,
  });
}

/**
 * @param {string} temp_directory
 * @param {ReturnType<typeof createResumeRuntimeRecord>} runtime_record
 * @returns {Promise<Awaited<ReturnType<typeof resumeTaskAttempt>>>}
 */
async function executeResumeAttempt(temp_directory, runtime_record) {
  const previous_codex_bin = process.env.PRAVAHA_CODEX_BIN;
  const previous_codex_last_message =
    process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE;
  process.env.PRAVAHA_CODEX_BIN =
    await installFakeCodexExecutable(temp_directory);
  process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE = 'completed';

  try {
    return await resumeTaskAttempt(temp_directory, {
      runtime_record,
      runtime_record_path: join(temp_directory, '.pravaha/runtime/demo.json'),
    });
  } finally {
    restoreEnvironmentVariable('PRAVAHA_CODEX_BIN', previous_codex_bin);
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_LAST_MESSAGE',
      previous_codex_last_message,
    );
  }
}

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {void}
 */
function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
