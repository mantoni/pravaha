/* eslint-disable max-lines-per-function */
import { expect, it } from 'vitest';

import {
  createRuntimeRecord,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCurrentHandlerName,
  getRuntimeRecordFlowState,
  getRuntimeRecordFlowWaitState,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreePath,
  getRuntimeRecordWorktreeSlot,
} from './runtime-record-model.js';

it('creates a JavaScript runtime record without legacy step fields', () => {
  const runtime_record = createRuntimeRecord({
    binding_targets: {
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/test.md',
    current_handler_name: 'main',
    flow_path: 'docs/flows/runtime/test.js',
    flow_state: {
      phase: 'implement',
    },
    format_version: 'javascript-flow-v1',
    outcome: null,
    run_id: 'run:demo',
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_identity: 'workspace-1',
    worktree_mode: 'pooled',
    worktree_path: '/repo/.pravaha/workspaces/workspace-1',
  });

  expect(runtime_record).not.toHaveProperty('await_query');
  expect(runtime_record).not.toHaveProperty('job_state');
  expect(runtime_record).not.toHaveProperty('lease');
  expect(runtime_record).not.toHaveProperty('steps');
  expect(runtime_record).not.toHaveProperty('worker');
  expect(runtime_record.execution).toEqual({
    run_id: 'run:demo',
  });
  expect(runtime_record.worktree).toEqual({
    identity: 'workspace-1',
    mode: 'pooled',
    path: '/repo/.pravaha/workspaces/workspace-1',
  });
});

it('reads the JavaScript runtime record fields', () => {
  const runtime_record = createRuntimeRecord({
    binding_targets: {
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/test.md',
    current_handler_name: 'onApprove',
    flow_path: 'docs/flows/runtime/test.js',
    flow_state: {
      approved: true,
    },
    format_version: 'javascript-flow-v1',
    outcome: 'success',
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
    worker_error: null,
    worker_final_response: '{"summary":"done"}',
    worker_item_count: 1,
    worker_thread_id: 'thread-1',
    worker_usage: null,
    worktree_identity: 'workspace-1',
    worktree_mode: 'pooled',
    worktree_path: '/repo/.pravaha/workspaces/workspace-1',
    worktree_slot: 'workspace-1',
  });

  expect(getRuntimeRecordFormatVersion(runtime_record)).toBe(
    'javascript-flow-v1',
  );
  expect(getRuntimeRecordBindingTargets(runtime_record)).toEqual({
    doc: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
  expect(getRuntimeRecordCurrentHandlerName(runtime_record)).toBe('onApprove');
  expect(getRuntimeRecordFlowState(runtime_record)).toEqual({
    approved: true,
  });
  expect(getRuntimeRecordFlowWaitState(runtime_record)).toEqual({
    data: {
      verdict: 'approve',
    },
    handler_name: 'onApprove',
    kind: 'approval',
  });
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('success');
  expect(getRuntimeRecordRunId(runtime_record)).toBe('run:demo');
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBe('demo');
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBe(
    'docs/tasks/runtime/demo.md',
  );
  expect(getRuntimeRecordWorktreeIdentity(runtime_record)).toBe('workspace-1');
  expect(getRuntimeRecordWorktreeMode(runtime_record)).toBe('pooled');
  expect(getRuntimeRecordWorktreePath(runtime_record)).toBe(
    '/repo/.pravaha/workspaces/workspace-1',
  );
  expect(getRuntimeRecordWorktreeSlot(runtime_record)).toBe('workspace-1');
});

it('omits optional execution and flow-state fields when they are not provided', () => {
  const runtime_record = createRuntimeRecord({
    contract_path: 'docs/contracts/runtime/test.md',
    flow_path: 'docs/flows/runtime/test.js',
    outcome: null,
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_path: '/repo/.pravaha/workspaces/workspace-1',
  });

  expect(runtime_record.execution).toEqual({});
  expect(runtime_record.binding_targets).toBeUndefined();
  expect(runtime_record.flow_state).toBeUndefined();
  expect(runtime_record.worktree).toBeUndefined();
});

it('filters malformed binding targets when reading runtime records', () => {
  expect(
    getRuntimeRecordBindingTargets({
      binding_targets: {
        bad: 'nope',
        also_bad: {
          id: 'task:demo',
          path: 1,
          status: 'ready',
        },
      },
    }),
  ).toBeNull();
});

it('falls back for missing or malformed runtime record fields', () => {
  const runtime_record = {
    execution: {},
    local_outcome: {},
    selected_task: {},
  };

  expect(getRuntimeRecordCurrentHandlerName(runtime_record)).toBeNull();
  expect(getRuntimeRecordFlowState(runtime_record)).toEqual({});
  expect(getRuntimeRecordFlowWaitState(runtime_record)).toBeNull();
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('unresolved');
  expect(getRuntimeRecordRunId(runtime_record)).toBeNull();
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBeNull();
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBeNull();
});

it('preserves approval fields while recording worktree state', () => {
  const runtime_record = createRuntimeRecord({
    approval: {
      approved_at: null,
      requested_at: '2026-03-27T10:00:00.000Z',
    },
    contract_path: 'docs/contracts/runtime/test.md',
    flow_path: 'docs/flows/runtime/test.js',
    outcome: 'failure',
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
    worker_error: 'boom',
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_identity: 'named-workspace',
    worktree_mode: 'named',
    worktree_path: '/repo/.pravaha/workspaces/named-workspace',
  });

  expect(runtime_record.approval).toEqual({
    approved_at: null,
    requested_at: '2026-03-27T10:00:00.000Z',
  });
  expect(runtime_record.worktree).toEqual({
    identity: 'named-workspace',
    mode: 'named',
    path: '/repo/.pravaha/workspaces/named-workspace',
  });
});
