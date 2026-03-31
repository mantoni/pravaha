import { expect, it } from 'vitest';

import {
  createEmptyStatusGroups,
  createFlowSummary,
  resolveFlowStatus,
  sortStatusGroups,
} from './status-model.js';

it('resolves running, succeeded, and failed flow statuses', () => {
  const active_assignments_by_flow_instance_id = new Map([
    [
      'flow-instance:running',
      { flow_instance_id: 'flow-instance:running', worker_id: 'worker-a' },
    ],
  ]);

  expect(
    resolveFlowStatus(
      {
        local_outcome: {
          state: 'unresolved',
        },
      },
      'flow-instance:running',
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('running');
  expect(
    resolveFlowStatus(
      {
        local_outcome: {
          state: 'success',
        },
      },
      null,
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('succeeded');
  expect(
    resolveFlowStatus(
      {
        local_outcome: {
          state: 'failure',
        },
      },
      null,
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('failed');
});

it('resolves waiting approval and waiting queue flow statuses', () => {
  /** @type {Map<string, { flow_instance_id: string, worker_id: string }>} */
  const active_assignments_by_flow_instance_id = new Map();

  expect(
    resolveFlowStatus(
      {
        approval: {
          approved_at: null,
          requested_at: '2026-03-29T10:00:00.000Z',
        },
        local_outcome: {
          state: 'unresolved',
        },
      },
      null,
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('waiting-approval');
  expect(
    resolveFlowStatus(
      {
        local_outcome: {
          state: 'unresolved',
        },
        queue_wait: {
          branch_head: 'abc123',
          branch_ref: 'refs/heads/review/queue',
          outcome: null,
          ready_ref: 'refs/queue/ready/1',
          state: 'waiting',
        },
      },
      null,
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('waiting-queue');
});

it('resolves pending flow statuses', () => {
  /** @type {Map<string, { flow_instance_id: string, worker_id: string }>} */
  const active_assignments_by_flow_instance_id = new Map();

  expect(
    resolveFlowStatus(
      {
        local_outcome: {
          state: 'unresolved',
        },
      },
      null,
      active_assignments_by_flow_instance_id,
    ),
  ).toBe('pending');
});

it('projects running flow summaries with checkout and worker details', () => {
  const runtime_record = {
    contract_path: 'docs/contracts/runtime/status-command.md',
    execution: {
      run_id: 'run:running-task',
    },
    flow_path: 'docs/flows/runtime/status-command.js',
    flow_state: {
      current_handler_name: 'main',
    },
    selected_task: {
      id: 'running-task',
      path: 'docs/tasks/runtime/running-task.md',
    },
    worktree: {
      path: '/repo/.pravaha/worktrees/running-task',
    },
  };

  expect(
    createFlowSummary(runtime_record, 'flow-instance:running', 'running', {
      flow_instance_id: 'flow-instance:running',
      worker_id: 'worker-a',
    }),
  ).toEqual({
    checkout_directory: '/repo/.pravaha/worktrees/running-task',
    contract_path: 'docs/contracts/runtime/status-command.md',
    current_handler_name: 'main',
    flow_instance_id: 'flow-instance:running',
    flow_path: 'docs/flows/runtime/status-command.js',
    run_id: 'run:running-task',
    task_id: 'running-task',
    task_path: 'docs/tasks/runtime/running-task.md',
    worker_id: 'worker-a',
  });
});

it('projects non-running flow summaries without live-only fields', () => {
  expect(
    createFlowSummary(
      {
        selected_task: {
          id: 'pending-task',
        },
      },
      null,
      'pending',
      undefined,
    ),
  ).toEqual({
    task_id: 'pending-task',
  });
});

it('sorts status groups by flow instance id', () => {
  const flows_by_status = createEmptyStatusGroups();

  flows_by_status.running.push(
    {
      flow_instance_id: 'flow-instance:b',
    },
    {
      flow_instance_id: 'flow-instance:a',
    },
  );

  sortStatusGroups(flows_by_status);

  expect(flows_by_status.running).toEqual([
    {
      flow_instance_id: 'flow-instance:a',
    },
    {
      flow_instance_id: 'flow-instance:b',
    },
  ]);
});

it('sorts status groups by task path when flow instance ids are missing', () => {
  const flows_by_status = createEmptyStatusGroups();

  flows_by_status.pending.push(
    {
      task_path: 'docs/tasks/runtime/b-task.md',
    },
    {
      task_path: 'docs/tasks/runtime/a-task.md',
    },
  );

  sortStatusGroups(flows_by_status);

  expect(flows_by_status.pending).toEqual([
    {
      task_path: 'docs/tasks/runtime/a-task.md',
    },
    {
      task_path: 'docs/tasks/runtime/b-task.md',
    },
  ]);
});

it('sorts status groups by fallback JSON when no primary sort keys exist', () => {
  const flows_by_status = createEmptyStatusGroups();

  flows_by_status.failed.push(
    {
      name: 'zeta',
    },
    {
      name: 'alpha',
    },
  );

  sortStatusGroups(flows_by_status);

  expect(flows_by_status.failed).toEqual([
    {
      name: 'alpha',
    },
    {
      name: 'zeta',
    },
  ]);
});
