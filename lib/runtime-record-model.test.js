/* eslint-disable max-lines-per-function */
import { expect, it } from 'vitest';

import {
  createRuntimeRecord,
  getRuntimeRecordAwaitQuery,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordNextStepIndex,
  getRuntimeRecordOrderedSteps,
  getRuntimeRecordPrompt,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordTransitionConditions,
  getRuntimeRecordTransitionTargetBindings,
  getRuntimeRecordTransitionTargets,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreeSlot,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreePath,
} from './runtime-record-model.js';

it('creates the strict runtime record shape and reads nested fields', () => {
  const runtime_record = createRuntimeRecord({
    await_query: '$class == $signal and kind == worker_completed',
    binding_targets: {
      document: {
        id: 'contract:single-task-flow-reconciler',
        path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
        status: 'proposed',
      },
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    completed_at: '2026-03-25T12:00:00.000Z',
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'success',
    prompt: 'Persisted prompt.',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
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
    worker_error: null,
    worker_final_response: '{"summary":"ok"}',
    worker_item_count: 1,
    worker_thread_id: 'thread-success',
    worker_usage: null,
    worktree_identity: 'castello',
    worktree_mode: 'named',
    worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
    worktree_slot: 'castello',
  });

  assertRuntimeRecordFields(runtime_record);
});

it('falls back to legacy flat runtime fields when needed', () => {
  const runtime_record = {
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'failure',
    task_id: 'legacy-task',
    task_path: 'docs/tasks/runtime/legacy-task.md',
    worktree_identity: 'legacy-task',
    worktree_mode: 'named',
    worktree_path: '/repo/.pravaha/worktrees/legacy-task',
    worktree_slot: 'legacy-task',
  };

  expect(getRuntimeRecordLeaseTime(runtime_record)).toBe(
    '2026-03-25T11:00:00.000Z',
  );
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('failure');
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBe('legacy-task');
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBe(
    'docs/tasks/runtime/legacy-task.md',
  );
  expect(getRuntimeRecordAwaitQuery(runtime_record)).toBe(
    '$class == $signal and kind == worker_completed and subject == task',
  );
  expect(getRuntimeRecordBindingTargets(runtime_record)).toEqual({
    task: {
      id: 'task:legacy-task',
      path: 'docs/tasks/runtime/legacy-task.md',
      status: 'ready',
    },
  });
  expect(getRuntimeRecordTransitionConditions(runtime_record)).toEqual({
    failure:
      '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
    success:
      '$class == $signal and kind == worker_completed and subject == task and outcome == success',
  });
  expect(getRuntimeRecordTransitionTargetBindings(runtime_record)).toEqual({
    failure: 'task',
    success: 'task',
  });
  expect(getRuntimeRecordWorktreeIdentity(runtime_record)).toBe('legacy-task');
  expect(getRuntimeRecordWorktreeMode(runtime_record)).toBe('named');
  expect(getRuntimeRecordWorktreePath(runtime_record)).toBe(
    '/repo/.pravaha/worktrees/legacy-task',
  );
  expect(getRuntimeRecordWorktreeSlot(runtime_record)).toBe('legacy-task');
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
    getRuntimeRecordBindingTargets({ binding_targets: { task: {} } }),
  ).toBeNull();
  expect(
    getRuntimeRecordTransitionTargets({ transition_targets: {} }),
  ).toBeNull();
  expect(getRuntimeRecordWorktreeIdentity({ worktree: {} })).toBeNull();
  expect(getRuntimeRecordWorktreeMode({ worktree: {} })).toBeNull();
  expect(getRuntimeRecordWorkerThreadId({ worker: {} })).toBeNull();
  expect(getRuntimeRecordWorktreePath({ worktree: {} })).toBeNull();
  expect(getRuntimeRecordWorktreeSlot({ worktree: {} })).toBeNull();
});

it('falls back to default ordered steps and worker-step resume when execution fields are absent', () => {
  const runtime_record = {
    local_outcome: {
      state: 'unresolved',
    },
  };

  expect(getRuntimeRecordOrderedSteps(runtime_record)).toEqual([
    {
      kind: 'uses',
      step_name: 'core/setup-worktree',
    },
    {
      kind: 'uses',
      step_name: 'core/codex-sdk',
    },
  ]);
  expect(getRuntimeRecordNextStepIndex(runtime_record)).toBe(1);
});

it('ignores invalid persisted steps and falls back to path-based worktree identity', () => {
  const runtime_record = {
    local_outcome: {
      state: 'success',
    },
    steps: [
      {
        command_text: 'printf before',
        kind: 'run',
      },
      {
        kind: 'uses',
        step_name: 'core/codex-sdk',
      },
      {
        kind: 'uses',
      },
    ],
    worktree: {
      path: '/repo/.pravaha/worktrees/castello',
    },
  };

  expect(getRuntimeRecordOrderedSteps(runtime_record)).toEqual([
    {
      command_text: 'printf before',
      kind: 'run',
    },
    {
      kind: 'uses',
      step_name: 'core/codex-sdk',
    },
  ]);
  expect(getRuntimeRecordNextStepIndex(runtime_record)).toBe(2);
  expect(getRuntimeRecordWorktreeIdentity(runtime_record)).toBe('castello');
});

it('falls back to the ordered-step length when no worker step is present', () => {
  const runtime_record = {
    local_outcome: {
      state: 'unresolved',
    },
    steps: [
      {
        command_text: 'printf before',
        kind: 'run',
      },
    ],
  };

  expect(getRuntimeRecordNextStepIndex(runtime_record)).toBe(1);
});

/**
 * @param {ReturnType<typeof createRuntimeRecord>} runtime_record
 */
function assertRuntimeRecordFields(runtime_record) {
  expect(getRuntimeRecordAwaitQuery(runtime_record)).toBe(
    '$class == $signal and kind == worker_completed',
  );
  expect(getRuntimeRecordBindingTargets(runtime_record)).toEqual({
    document: {
      id: 'contract:single-task-flow-reconciler',
      path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
      status: 'proposed',
    },
    task: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  });
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
  expect(getRuntimeRecordTransitionConditions(runtime_record)).toEqual({
    failure: '$class == $signal and outcome == failure',
    success: '$class == $signal and outcome == success',
  });
  expect(getRuntimeRecordTransitionTargetBindings(runtime_record)).toEqual({
    failure: 'task',
    success: 'document',
  });
  expect(getRuntimeRecordTransitionTargets(runtime_record)).toEqual({
    failure: 'blocked',
    success: 'review',
  });
  expect(getRuntimeRecordWorktreeIdentity(runtime_record)).toBe('castello');
  expect(getRuntimeRecordWorktreeMode(runtime_record)).toBe('named');
  expect(getRuntimeRecordWorkerThreadId(runtime_record)).toBe('thread-success');
  expect(getRuntimeRecordWorktreePath(runtime_record)).toBe(
    '/repo/.pravaha/worktrees/implement-runtime-slice',
  );
  expect(getRuntimeRecordWorktreeSlot(runtime_record)).toBe('castello');
}
