import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { createSuccessRunResult } from './run-happy-path.assertions-test-helpers.js';
import { resumeTaskAttempt, runTaskAttempt } from './runtime-attempt.js';
import {
  createTaskAttemptContext,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';

it('persists generic ordered-step progress before a later worker step starts', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {Record<string, unknown> | null} */
  let observed_runtime_record = null;

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createRunTaskAttemptOptions({
        ordered_steps: [
          {
            command_text: "printf 'prepared\\n' > prepared.txt",
            kind: 'run',
          },
          {
            kind: 'uses',
            step_name: 'core/codex-sdk',
          },
        ],
        worker_client: createObservedRuntimeWorkerClient(
          temp_directory,
          (runtime_record) => {
            observed_runtime_record = runtime_record;
          },
        ),
      }),
    );

    expect(observed_runtime_record).toMatchObject({
      execution: {
        next_step_index: 1,
      },
      local_outcome: {
        state: 'unresolved',
      },
    });
    expect(
      await readFile(join(run_result.worktree_path, 'prepared.txt'), 'utf8'),
    ).toBe('prepared\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes from the first incomplete ordered step without rerunning completed earlier steps', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await assertResumeSkipsCompletedEarlierStep(temp_directory);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function assertResumeSkipsCompletedEarlierStep(temp_directory) {
  const ordered_steps = createProgressOrderedSteps();
  const attempt_context = await createProgressAttemptContext(
    temp_directory,
    ordered_steps,
  );
  const unresolved_runtime_record = await seedUnresolvedProgressRecord(
    attempt_context,
    ordered_steps,
  );
  const unresolved_run_id = readExecutionRunId(unresolved_runtime_record);
  const run_result = await resumeProgressRun(
    temp_directory,
    unresolved_runtime_record,
    attempt_context.runtime_record_path,
  );
  const final_runtime_record = JSON.parse(
    await readFile(run_result.runtime_record_path, 'utf8'),
  );

  expect(
    await readFile(join(run_result.worktree_path, 'steps.log'), 'utf8'),
  ).toBe('one\ntwo\nthree\n');
  expect(final_runtime_record).toMatchObject({
    execution: {
      next_step_index: 3,
      run_id: unresolved_run_id,
    },
    local_outcome: {
      state: 'success',
    },
  });
}

/**
 * @param {string} temp_directory
 * @param {Array<{ command_text: string, kind: 'run' }>} ordered_steps
 * @returns {Promise<Awaited<ReturnType<typeof createTaskAttemptContext>>>}
 */
async function createProgressAttemptContext(temp_directory, ordered_steps) {
  return createTaskAttemptContext(
    temp_directory,
    {
      contract_path: CONTRACT_PATH,
      decision_paths: [],
      flow_path: FLOW_PATH,
      ordered_steps,
      runtime_label: 'Pravaha single-task flow reconciler slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      worktree_policy: {
        mode: 'ephemeral',
      },
    },
    () => new Date('2026-03-25T12:00:00.000Z'),
  );
}

/**
 * @param {Awaited<ReturnType<typeof createTaskAttemptContext>>} attempt_context
 * @param {Array<{ command_text: string, kind: 'run' }>} ordered_steps
 * @returns {Promise<Record<string, unknown>>}
 */
async function seedUnresolvedProgressRecord(attempt_context, ordered_steps) {
  await writeFile(join(attempt_context.worktree_path, 'steps.log'), 'one\n');
  await writeUnresolvedRuntimeRecord(
    createUnresolvedProgressRecordContext(ordered_steps),
    attempt_context,
    null,
  );

  return JSON.parse(
    await readFile(attempt_context.runtime_record_path, 'utf8'),
  );
}

/**
 * @param {string} temp_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {string} runtime_record_path
 * @returns {Promise<Awaited<ReturnType<typeof resumeTaskAttempt>>>}
 */
async function resumeProgressRun(
  temp_directory,
  runtime_record,
  runtime_record_path,
) {
  return resumeTaskAttempt(temp_directory, {
    now: () => new Date('2026-03-25T12:30:00.000Z'),
    runtime_record,
    runtime_record_path,
  });
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string}
 */
function readExecutionRunId(runtime_record) {
  const execution = /** @type {Record<string, unknown> | null} */ (
    runtime_record.execution
  );

  if (
    execution === null ||
    typeof execution !== 'object' ||
    typeof execution.run_id !== 'string'
  ) {
    throw new Error(
      'Expected the unresolved runtime record to contain a run id.',
    );
  }

  return execution.run_id;
}

/**
 * @param {{
 *   ordered_steps: Parameters<typeof runTaskAttempt>[1]['ordered_steps'],
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
 * }} options
 * @returns {Parameters<typeof runTaskAttempt>[1]}
 */
function createRunTaskAttemptOptions(options) {
  return {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    ordered_steps: options.ordered_steps,
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
        id: 'thread-progress',
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
 * @returns {Array<{ command_text: string, kind: 'run' }>}
 */
function createProgressOrderedSteps() {
  return [
    {
      command_text: "printf 'one\\n' >> steps.log",
      kind: 'run',
    },
    {
      command_text: "printf 'two\\n' >> steps.log",
      kind: 'run',
    },
    {
      command_text: "printf 'three\\n' >> steps.log",
      kind: 'run',
    },
  ];
}

/**
 * @param {Array<{ command_text: string, kind: 'run' }>} ordered_steps
 * @returns {Parameters<typeof writeUnresolvedRuntimeRecord>[0]}
 */
function createUnresolvedProgressRecordContext(ordered_steps) {
  return {
    await_query:
      '$class == $signal and kind == worker_completed and subject == task',
    binding_targets: {
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    next_step_index: 1,
    ordered_steps,
    signals: [],
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_conditions: {
      failure:
        '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
      success:
        '$class == $signal and kind == worker_completed and subject == task and outcome == success',
    },
    transition_target_bindings: {
      failure: 'task',
      success: 'task',
    },
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
  };
}
