/* eslint-disable max-lines-per-function */
import { expect, it } from 'vitest';

import {
  createRuntimeRecord,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCurrentJobName,
  getRuntimeRecordFormatVersion,
  getRuntimeRecordJobOutputs,
  getRuntimeRecordJobVisitCounts,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordRunId,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordSelectedTaskPath,
} from './runtime-record-model.js';

it('creates a state-machine runtime record without legacy step fields', () => {
  const runtime_record = createRuntimeRecord({
    binding_targets: {
      task: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/test.md',
    current_job_name: 'implement',
    flow_path: 'docs/flows/runtime/test.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {
      implement: {
        outcome: 'success',
      },
    },
    job_visit_counts: {
      implement: 1,
    },
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
  expect(runtime_record).not.toHaveProperty('lease');
  expect(runtime_record).not.toHaveProperty('steps');
  expect(runtime_record).not.toHaveProperty('worker');
  expect(runtime_record).not.toHaveProperty('worktree');
  expect(runtime_record.execution).toEqual({
    run_id: 'run:demo',
  });
});

it('reads the state-machine runtime record fields', () => {
  const runtime_record = createRuntimeRecord({
    binding_targets: {
      task: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/test.md',
    current_job_name: 'review',
    flow_path: 'docs/flows/runtime/test.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {
      implement: {
        outcome: 'success',
      },
    },
    job_visit_counts: {
      implement: 1,
      review: 2,
    },
    outcome: 'success',
    run_id: 'run:demo',
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
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
    'state-machine-v2',
  );
  expect(getRuntimeRecordBindingTargets(runtime_record)).toEqual({
    task: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
  expect(getRuntimeRecordCurrentJobName(runtime_record)).toBe('review');
  expect(getRuntimeRecordJobOutputs(runtime_record)).toEqual({
    implement: {
      outcome: 'success',
    },
  });
  expect(getRuntimeRecordJobVisitCounts(runtime_record)).toEqual({
    implement: 1,
    review: 2,
  });
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('success');
  expect(getRuntimeRecordRunId(runtime_record)).toBe('run:demo');
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBe('demo');
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBe(
    'docs/tasks/runtime/demo.md',
  );
});

it('omits optional execution and job-state fields when they are not provided', () => {
  const runtime_record = createRuntimeRecord({
    contract_path: 'docs/contracts/runtime/test.md',
    flow_path: 'docs/flows/runtime/test.yaml',
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
  expect(runtime_record.job_state).toBeUndefined();
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
    job_state: {
      job_visit_counts: {
        bad_zero: 0,
        bad_float: 1.5,
      },
    },
    local_outcome: {},
    selected_task: {},
  };

  expect(getRuntimeRecordJobVisitCounts(runtime_record)).toEqual({});
  expect(getRuntimeRecordLocalOutcomeState(runtime_record)).toBe('unresolved');
  expect(getRuntimeRecordRunId(runtime_record)).toBeNull();
  expect(getRuntimeRecordSelectedTaskId(runtime_record)).toBeNull();
  expect(getRuntimeRecordSelectedTaskPath(runtime_record)).toBeNull();
});

it('preserves approval fields while omitting operational worktree state', () => {
  const runtime_record = createRuntimeRecord({
    approval: {
      approved_at: null,
      requested_at: '2026-03-27T10:00:00.000Z',
    },
    contract_path: 'docs/contracts/runtime/test.md',
    flow_path: 'docs/flows/runtime/test.yaml',
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
});
