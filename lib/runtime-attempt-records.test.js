import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import {
  createResumeAttemptContext,
  createTaskAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';

it('creates a task attempt context with a prepared worktree and persisted prompt', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const attempt_context = await createTaskAttemptContext(
      temp_directory,
      {
        contract_path: CONTRACT_PATH,
        decision_paths: [],
        flow_path: FLOW_PATH,
        runtime_label: 'Pravaha single-task flow reconciler slice',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
      () => new Date('2026-03-25T12:00:00.000Z'),
    );

    await access(attempt_context.worktree_path);
    expect(attempt_context.prompt).toContain(CONTRACT_PATH);
    expect(attempt_context.runtime_record_path).toBe(
      join(temp_directory, '.pravaha/runtime/implement-runtime-slice.json'),
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('creates a resume attempt context from the exact recorded runtime fields', () => {
  const runtime_record_path = '/repo/.pravaha/runtime/task.json';

  expect(
    createResumeAttemptContext(
      '/repo',
      {
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        flow_path: '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        lease: {
          leased_at: '2026-03-25T12:00:00.000Z',
        },
        prompt: 'Persisted prompt.',
        selected_task: {
          id: 'implement-runtime-slice',
          path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        },
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
        worker: {
          thread_id: 'thread-resume',
        },
        worktree: {
          path: '/repo/.pravaha/worktrees/implement-runtime-slice',
        },
      },
      runtime_record_path,
    ),
  ).toMatchObject({
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    worker_thread_id: 'thread-resume',
  });
});

it('rejects resume records that omit transition targets', () => {
  expect(() =>
    createResumeAttemptContext(
      '/repo',
      {
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        lease: {
          leased_at: '2026-03-25T12:00:00.000Z',
        },
        prompt: 'Persisted prompt.',
        selected_task: {
          id: 'implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
        },
        worktree: {
          path: '/repo/.pravaha/worktrees/implement-runtime-slice',
        },
      },
      '/repo/.pravaha/runtime/task.json',
    ),
  ).toThrow(
    'Expected /repo/.pravaha/runtime/task.json to record transition targets.',
  );
});

it('writes unresolved and final runtime records for the exact attempt context', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeExactAttemptRecord(temp_directory, runtime_record_path);
    const runtime_record = JSON.parse(
      await readFile(runtime_record_path, 'utf8'),
    );

    expect(runtime_record).toMatchObject({
      local_outcome: {
        completed_at: '2026-03-25T12:30:00.000Z',
        state: 'success',
      },
      worker: {
        thread_id: 'thread-runtime',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects record writes that do not have any lease time available', async () => {
  await expect(
    writeUnresolvedRuntimeRecord(
      {
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
      },
      {
        prompt: 'Persisted prompt.',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      },
      'thread-runtime',
    ),
  ).rejects.toThrow('Expected a lease time for the runtime record.');
});

/**
 * @param {string} temp_directory
 * @param {string} runtime_record_path
 * @returns {Promise<void>}
 */
async function writeExactAttemptRecord(temp_directory, runtime_record_path) {
  const runtime_record_context = {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
  };
  const attempt_context = {
    prompt: 'Persisted prompt.',
    runtime_record_path,
    started_at: '2026-03-25T12:00:00.000Z',
    worktree_path: join(
      temp_directory,
      '.pravaha/worktrees/implement-runtime-slice',
    ),
  };

  await writeUnresolvedRuntimeRecord(
    runtime_record_context,
    attempt_context,
    'thread-runtime',
  );
  await writeFinalRuntimeRecord(
    runtime_record_context,
    attempt_context,
    {
      outcome: 'success',
      worker_error: null,
      worker_final_response: '{"summary":"ok"}',
      worker_item_count: 1,
      worker_thread_id: 'thread-runtime',
      worker_usage: null,
    },
    () => new Date('2026-03-25T12:30:00.000Z'),
  );
}
