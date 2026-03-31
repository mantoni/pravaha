import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  cleanupAttemptContext,
  createFlowAttemptContext,
  createFlowResumeAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const FLOW_PATH = 'docs/flows/runtime/single-task-flow-reconciler.js';
const TASK_ID = 'implement-runtime-slice';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

it('creates a flow attempt context with a prepared pooled workspace', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(
      repo_directory,
      'pooled',
    );

    expect(attempt_context.run_id).toBe(
      'run:implement-runtime-slice:2026-03-27T10:00:00.000Z',
    );
    expect(attempt_context.worktree_assignment.mode).toBe('pooled');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('creates a flow resume attempt context from the recorded runtime fields', () => {
  const attempt_context = createFlowResumeAttemptContext(
    '/repo',
    createRuntimeRecord(createRecordedRuntimeRecordOptions()),
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.current_handler_name).toBe('onApprove');
  expect(attempt_context.flow_state).toEqual({
    approved: true,
  });
  expect(attempt_context.queue_wait).toEqual({
    branch_head: 'queue-head',
    branch_ref: 'refs/heads/review/demo',
    outcome: null,
    ready_ref: 'refs/queue/ready/0001-review-demo',
    state: 'waiting',
  });
  expect(attempt_context.run_id).toBe('run:demo');
  expect(attempt_context.task_path).toBe('docs/tasks/runtime/demo.md');
  expect(attempt_context.wait_state).toEqual({
    data: {
      verdict: 'approve',
    },
    handler_name: 'onApprove',
    kind: 'approval',
  });
  expect(attempt_context.recorded_worktree).toEqual({
    identity: '/repo/.pravaha/worktrees/pooled-demo-main',
    mode: 'pooled',
    path: '/repo/.pravaha/worktrees/pooled-demo-main',
    slot: 'demo',
  });
});

it('rejects legacy resume records for the JavaScript flow runtime', () => {
  expect(() =>
    createFlowResumeAttemptContext(
      '/repo',
      {
        contract_path: CONTRACT_PATH,
      },
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Legacy unresolved runtime record /repo/.pravaha/runtime/demo.json is incompatible with the JavaScript flow runtime. Clear local runtime state before continuing.',
  );
});

it('rejects resume records that omit a required current handler name', () => {
  expect(() =>
    createFlowResumeAttemptContext(
      '/repo',
      createRuntimeRecord({
        ...createRecordedRuntimeRecordOptions(),
        current_handler_name: undefined,
      }),
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Expected /repo/.pravaha/runtime/demo.json to record a current handler name.',
  );
});

it('writes JavaScript runtime records without legacy step fields', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);
    const unresolved_record = await writeUnresolvedRuntimeRecord(
      createRuntimeRecordContext(attempt_context, 'main'),
      attempt_context,
      null,
    );
    const final_record = await writeFinalRuntimeRecord(
      createRuntimeRecordContext(attempt_context, 'onApprove', {
        approved: true,
      }),
      attempt_context,
      {
        outcome: 'success',
        worker_error: null,
        worker_final_response: '{"summary":"done"}',
        worker_item_count: 1,
        worker_thread_id: 'thread-1',
        worker_usage: null,
      },
      () => new Date('2026-03-27T10:05:00.000Z'),
    );

    expect(unresolved_record).not.toHaveProperty('job_state');
    expect(unresolved_record.format_version).toBe('javascript-flow-v1');
    expect(unresolved_record.flow_state).toEqual({
      current_handler_name: 'main',
      durable_state: {},
    });
    expect(final_record.local_outcome).toMatchObject({
      completed_at: '2026-03-27T10:05:00.000Z',
      state: 'success',
    });
    expect(final_record.flow_state).toEqual({
      current_handler_name: 'onApprove',
      durable_state: {
        approved: true,
      },
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('cleans up ephemeral workspaces after JavaScript flow attempts', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);

    await cleanupAttemptContext(attempt_context);

    expect(attempt_context.worktree_assignment.mode).toBe('ephemeral');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('keeps pooled workspaces in place after JavaScript flow attempts', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(
      repo_directory,
      'pooled',
    );

    await expect(
      cleanupAttemptContext(attempt_context),
    ).resolves.toBeUndefined();
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('normalizes absolute binding target paths when resuming JavaScript runtime records', () => {
  const attempt_context = createFlowResumeAttemptContext(
    '/repo',
    createRuntimeRecord({
      ...createRecordedRuntimeRecordOptions(),
      binding_targets: {
        doc: {
          id: 'task:demo',
          path: '/repo/docs/tasks/runtime/demo.md',
          status: 'ready',
        },
      },
    }),
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.binding_targets).toEqual({
    doc: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
});

it('rejects resume records that omit binding targets and tolerates absent recorded worktrees', () => {
  expect(() =>
    createFlowResumeAttemptContext(
      '/repo',
      createRuntimeRecord({
        ...createRecordedRuntimeRecordOptions(),
        binding_targets: undefined,
      }),
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Expected /repo/.pravaha/runtime/demo.json to record binding targets.',
  );

  const attempt_context = createFlowResumeAttemptContext(
    '/repo',
    createRuntimeRecord({
      ...createRecordedRuntimeRecordOptions(),
      binding_targets: {
        doc: {
          id: 'task:demo',
          path: '/repo/docs/tasks/runtime/demo.md',
          status: 'ready',
        },
        skipped: undefined,
      },
      worktree_identity: undefined,
      worktree_mode: undefined,
      worktree_path: undefined,
      worktree_slot: undefined,
    }),
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.recorded_worktree).toBeUndefined();
  expect(attempt_context.binding_targets).toEqual({
    doc: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
});

/**
 * @param {string} repo_directory
 * @param {'ephemeral' | 'pooled'} [mode]
 * @returns {Promise<Awaited<ReturnType<typeof createFlowAttemptContext>>>}
 */
function createAttemptContext(repo_directory, mode = 'ephemeral') {
  return createFlowAttemptContext(
    repo_directory,
    {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'Runtime slice',
      task_id: TASK_ID,
      task_path: TASK_PATH,
      workspace:
        mode === 'pooled'
          ? {
              id: 'app',
            }
          : {
              id: 'app',
              location: {
                path: `${repo_directory}/.pravaha/worktrees/${TASK_ID}`,
              },
              mode: 'ephemeral',
              ref: 'main',
              source: {
                kind: 'repo',
              },
            },
    },
    () => new Date('2026-03-27T10:00:00.000Z'),
  );
}

/**
 * @returns {Parameters<typeof createRuntimeRecord>[0]}
 */
function createRecordedRuntimeRecordOptions() {
  return {
    binding_targets: {
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_handler_name: 'onApprove',
    flow_path: FLOW_PATH,
    flow_state: {
      approved: true,
    },
    format_version: 'javascript-flow-v1',
    outcome: null,
    queue_wait: {
      branch_head: 'queue-head',
      branch_ref: 'refs/heads/review/demo',
      outcome: null,
      ready_ref: 'refs/queue/ready/0001-review-demo',
      state: 'waiting',
    },
    run_id: 'run:demo',
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
    wait_state: {
      data: {
        verdict: 'approve',
      },
      handler_name: 'onApprove',
      kind: 'approval',
    },
    worktree_identity: '/repo/.pravaha/worktrees/pooled-demo-main',
    worktree_mode: 'pooled',
    worktree_path: '/repo/.pravaha/worktrees/pooled-demo-main',
    worktree_slot: 'demo',
  };
}

/**
 * @param {Awaited<ReturnType<typeof createFlowAttemptContext>> & { run_id?: string }} attempt_context
 * @param {string} current_handler_name
 * @param {Record<string, unknown>} [flow_state]
 * @returns {Parameters<typeof writeUnresolvedRuntimeRecord>[0]}
 */
function createRuntimeRecordContext(
  attempt_context,
  current_handler_name,
  flow_state = {},
) {
  return {
    binding_targets: {
      doc: {
        id: `task:${TASK_ID}`,
        path: TASK_PATH,
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_handler_name,
    flow_path: FLOW_PATH,
    flow_state,
    format_version: 'javascript-flow-v1',
    run_id: attempt_context.run_id,
    task_id: TASK_ID,
    task_path: TASK_PATH,
  };
}
