import { expect, it } from 'vitest';

import {
  createRuntimeRecord,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordPrompt,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
} from './runtime-record-model.js';

it('creates the strict runtime record shape and reads nested fields', () => {
  const runtime_record = createRuntimeRecord({
    completed_at: '2026-03-25T12:00:00.000Z',
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'success',
    prompt: 'Persisted prompt.',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker_error: null,
    worker_final_response: '{"summary":"ok"}',
    worker_item_count: 1,
    worker_thread_id: 'thread-success',
    worker_usage: null,
    worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
  });

  assertRuntimeRecordFields(runtime_record);
});

it('falls back to legacy flat runtime fields when needed', () => {
  const runtime_record = {
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'failure',
    task_id: 'legacy-task',
    task_path: 'docs/tasks/runtime/legacy-task.md',
    worktree_path: '/repo/.pravaha/worktrees/legacy-task',
  };

  expect(getRuntimeRecordLeaseTime(runtime_record)).toBe(
    '2026-03-25T11:00:00.000Z',
  );
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('failure');
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBe('legacy-task');
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBe(
    'docs/tasks/runtime/legacy-task.md',
  );
  expect(getRuntimeRecordWorktreePath(runtime_record)).toBe(
    '/repo/.pravaha/worktrees/legacy-task',
  );
});

it('returns null or unresolved when strict fields are absent or invalid', () => {
  expect(getRuntimeRecordContractPath({})).toBeNull();
  expect(getRuntimeRecordFlowPath({})).toBeNull();
  expect(getRuntimeRecordLeaseTime({ lease: {} })).toBeNull();
  expect(getRuntimeRecordLocalOutcomeState({})).toBe('unresolved');
  expect(getRuntimeRecordPrompt({ prompt: 42 })).toBeNull();
  expect(getRuntimeRecordSelectedTaskId({ selected_task: {} })).toBeNull();
  expect(getRuntimeRecordSelectedTaskPath({ selected_task: {} })).toBeNull();
  expect(
    getRuntimeRecordTransitionTargets({ transition_targets: {} }),
  ).toBeNull();
  expect(getRuntimeRecordWorkerThreadId({ worker: {} })).toBeNull();
  expect(getRuntimeRecordWorktreePath({ worktree: {} })).toBeNull();
});

/**
 * @param {ReturnType<typeof createRuntimeRecord>} runtime_record
 */
function assertRuntimeRecordFields(runtime_record) {
  expect(runtime_record).toMatchObject({
    local_outcome: {
      completed_at: '2026-03-25T12:00:00.000Z',
      state: 'success',
    },
    selected_task: {
      id: 'implement-runtime-slice',
    },
  });
  expect(getRuntimeRecordContractPath(runtime_record)).toBe(
    'docs/contracts/runtime/single-task-flow-reconciler.md',
  );
  expect(getRuntimeRecordFlowPath(runtime_record)).toBe(
    'docs/flows/runtime/single-task-flow-reconciler.md',
  );
  expect(getRuntimeRecordLeaseTime(runtime_record)).toBe(
    '2026-03-25T11:00:00.000Z',
  );
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('success');
  expect(getRuntimeRecordPrompt(runtime_record)).toBe('Persisted prompt.');
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBe(
    'implement-runtime-slice',
  );
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBe(
    'docs/tasks/runtime/implement-runtime-slice.md',
  );
  expect(getRuntimeRecordTransitionTargets(runtime_record)).toEqual({
    failure: 'blocked',
    success: 'review',
  });
  expect(getRuntimeRecordWorkerThreadId(runtime_record)).toBe('thread-success');
  expect(getRuntimeRecordWorktreePath(runtime_record)).toBe(
    '/repo/.pravaha/worktrees/implement-runtime-slice',
  );
}
