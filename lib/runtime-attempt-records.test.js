// @module-tag lint-staged-excluded

/* eslint-disable max-lines-per-function */
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
        worktree_policy: {
          mode: 'ephemeral',
        },
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

it('rejects task attempt context creation without an explicit worktree policy', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    /** @type {any} */
    const invalid_options = {
      contract_path: CONTRACT_PATH,
      decision_paths: [],
      flow_path: FLOW_PATH,
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
    };

    await expect(
      createTaskAttemptContext(
        temp_directory,
        invalid_options,
        () => new Date('2026-03-25T12:00:00.000Z'),
      ),
    ).rejects.toThrow('Expected an explicit worktree policy.');
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
        binding_targets: {
          document: {
            id: 'contract:single-task-flow-reconciler',
            path: '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
            status: 'proposed',
          },
          task: {
            id: 'task:implement-runtime-slice',
            path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        await_query: '$class == $signal and kind == worker_completed',
        transition_conditions: {
          failure: '$class == $signal and outcome == failure',
          success: '$class == $signal and outcome == success',
        },
        transition_target_bindings: {
          failure: 'task',
          success: 'document',
        },
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
        worker: {
          thread_id: 'thread-resume',
        },
        worktree: {
          identity: 'implement-runtime-slice',
          mode: 'named',
          path: '/repo/.pravaha/worktrees/implement-runtime-slice',
          slot: 'implement-runtime-slice',
        },
      },
      runtime_record_path,
    ),
  ).toMatchObject({
    await_query: '$class == $signal and kind == worker_completed',
    binding_targets: {
      document: {
        path: CONTRACT_PATH,
      },
      task: {
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
    },
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_target_bindings: {
      success: 'document',
    },
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
        worktree_assignment: createNamedWorktreeAssignment(
          '/repo/.pravaha/worktrees/implement-runtime-slice',
          'implement-runtime-slice',
        ),
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      },
      'thread-runtime',
    ),
  ).rejects.toThrow('Expected a lease time for the runtime record.');
});

it('rejects resume records that omit required persisted strings', () => {
  expect(() =>
    createResumeAttemptContext(
      '/repo',
      {
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        lease: {
          leased_at: '2026-03-25T12:00:00.000Z',
        },
        selected_task: {
          id: 'implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
        },
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
        worktree: {
          path: '/repo/.pravaha/worktrees/implement-runtime-slice',
        },
      },
      '/repo/.pravaha/runtime/task.json',
    ),
  ).toThrow('Expected /repo/.pravaha/runtime/task.json to record a prompt.');
});

it('rejects final runtime record writes without a lease time', async () => {
  await expect(
    writeFinalRuntimeRecord(
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
        worktree_assignment: createNamedWorktreeAssignment(
          '/repo/.pravaha/worktrees/implement-runtime-slice',
          'implement-runtime-slice',
        ),
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      },
      {
        outcome: 'success',
        worker_error: null,
        worker_final_response: '{"summary":"ok"}',
        worker_item_count: 1,
        worker_thread_id: 'thread-runtime',
        worker_usage: null,
      },
      () => new Date('2026-03-25T12:30:00.000Z'),
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
    worktree_assignment: createNamedWorktreeAssignment(
      join(temp_directory, '.pravaha/worktrees/implement-runtime-slice'),
      'implement-runtime-slice',
    ),
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

/**
 * @param {string} worktree_path
 * @param {string} slot
 * @returns {{
 *   identity: string,
 *   mode: 'named',
 *   path: string,
 *   slot: string,
 * }}
 */
function createNamedWorktreeAssignment(worktree_path, slot) {
  return {
    identity: slot,
    mode: 'named',
    path: worktree_path,
    slot,
  };
}
