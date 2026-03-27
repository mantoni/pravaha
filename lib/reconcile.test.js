/* eslint-disable max-lines-per-function */
// @module-tag lint-staged-excluded

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { reconcile } from './reconcile.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  createTaskFixture,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { createRuntimeRecord } from './runtime-record-model.js';
import { writeRuntimeRecord } from './runtime-files.js';

it('reports when no eligible task is available for the reconciler flow', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    task_documents: [createTaskFixture('implement-runtime-slice', 'blocked')],
  });

  try {
    await expect(reconcile(temp_directory)).resolves.toMatchObject({
      contract_path: join(temp_directory, CONTRACT_PATH),
      outcome: 'no-eligible-task',
      root_flow_path: join(temp_directory, FLOW_PATH),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('refuses to start new reconcile work when unresolved runtime state exists', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecord(
      runtime_record_path,
      createRuntimeRecord({
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        current_job_name: 'implement',
        flow_path: FLOW_PATH,
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {
          implement: 1,
        },
        leased_at: '2026-03-27T10:00:00.000Z',
        outcome: null,
        prompt: 'Persisted prompt.',
        run_id: 'run:implement-runtime-slice',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: null,
        worker_final_response: null,
        worker_item_count: 0,
        worker_thread_id: null,
        worker_usage: null,
        worktree_identity: 'pooled-app-main',
        worktree_mode: 'pooled',
        worktree_path: join(
          temp_directory,
          '.pravaha/worktrees/pooled-app-main',
        ),
      }),
    );

    await expect(reconcile(temp_directory)).resolves.toMatchObject({
      outcome: 'blocked',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('runs one eligible task from a state-machine reconciler flow', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          return {
            id: 'thread-reconcile',
            async run() {
              return {
                items: [],
                finalResponse: '{"summary":"done"}',
                usage: null,
              };
            },
          };
        },
      },
    });

    expect(run_result).toMatchObject({
      contract_path: join(temp_directory, CONTRACT_PATH),
      outcome: 'success',
      root_flow_path: join(temp_directory, FLOW_PATH),
      task_id: 'implement-runtime-slice',
      worker_thread_id: 'thread-reconcile',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
