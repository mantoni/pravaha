import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  createBlockedReconcileResult,
  listUnresolvedRuntimeRecords,
  loadSingleUnresolvedRuntimeRecord,
} from './runtime-records.js';

it('returns no unresolved runtime records when the runtime directory is missing', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-empty-');

  try {
    await expect(listUnresolvedRuntimeRecords(repo_directory)).resolves.toEqual(
      [],
    );
    await expect(
      loadSingleUnresolvedRuntimeRecord(repo_directory),
    ).rejects.toThrow('No unresolved runtime record is available to resume.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('lists only unresolved runtime records and sorts them by path', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-list-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'zeta.json'),
      createRecordFixture({
        local_outcome_state: 'success',
        task_id: 'zeta-task',
      }),
    );
    await writeRuntimeRecord(
      join(runtime_directory, 'beta.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'beta-task',
      }),
    );
    await writeRuntimeRecord(join(runtime_directory, 'alpha.json'), {
      outcome: null,
      task_id: 'alpha-task',
      task_path: 'docs/tasks/runtime/alpha-task.md',
      worktree_path: '/repo/.pravaha/worktrees/alpha-task',
    });

    const unresolved_runtime_records =
      await listUnresolvedRuntimeRecords(repo_directory);

    expect(
      unresolved_runtime_records.map((runtime_record) => runtime_record.record),
    ).toMatchObject([
      {
        task_id: 'alpha-task',
      },
      {
        selected_task: {
          id: 'beta-task',
        },
      },
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails closed when more than one unresolved runtime record exists', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-multi-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'first.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'first-task',
      }),
    );
    await writeRuntimeRecord(
      join(runtime_directory, 'second.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'second-task',
      }),
    );

    await expect(
      loadSingleUnresolvedRuntimeRecord(repo_directory),
    ).rejects.toThrow(
      'Cannot resume because 2 unresolved runtime records exist.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('renders operator-visible reconcile blocking details from unresolved records', async () => {
  const repo_directory = '/repo';
  const unresolved_runtime_records = [
    {
      record: createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'implement-runtime-slice',
      }),
      runtime_record_path:
        '/repo/.pravaha/runtime/implement-runtime-slice.json',
    },
  ];

  expect(
    createBlockedReconcileResult(repo_directory, unresolved_runtime_records),
  ).toMatchObject({
    blocking_records: [
      {
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        local_outcome_state: 'unresolved',
        root_flow_path:
          '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_record_path:
          '/repo/.pravaha/runtime/implement-runtime-slice.json',
        task_id: 'implement-runtime-slice',
      },
    ],
    outcome: 'blocked',
  });
});

/**
 * @param {string} prefix
 * @returns {Promise<string>}
 */
async function mkdirTempRepo(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * @param {{
 *   local_outcome_state: 'success' | 'unresolved',
 *   task_id: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRecordFixture(options) {
  return {
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
    lease: {
      leased_at: '2026-03-25T12:00:00.000Z',
    },
    local_outcome: {
      state: options.local_outcome_state,
    },
    prompt: 'Persisted prompt.',
    selected_task: {
      id: options.task_id,
      path: `docs/tasks/runtime/${options.task_id}.md`,
    },
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker: {
      error_message: null,
      final_response: null,
      item_count: 0,
      thread_id: 'thread-runtime',
      usage: null,
    },
    worktree: {
      path: `/repo/.pravaha/worktrees/${options.task_id}`,
    },
  };
}

/**
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecord(runtime_record_path, runtime_record) {
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}
