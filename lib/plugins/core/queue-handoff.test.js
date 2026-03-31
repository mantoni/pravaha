/** @import { CorePluginContext, QueueHandoffWith } from './types.ts' */
import { beforeEach, expect, it, vi } from 'vitest';

const { enqueueQueueHandoff } = vi.hoisted(() => {
  return {
    enqueueQueueHandoff: vi.fn(),
  };
});

vi.mock('../../queue/queue-handoff.js', () => {
  return {
    enqueueQueueHandoff,
  };
});

const { queueHandoff: queueHandoffPlugin } = await import('./queue-handoff.js');

beforeEach(() => {
  enqueueQueueHandoff.mockReset();
});

it('enqueues a branch ref and requests queue waiting on first execution', async () => {
  const requestQueueWait = vi.fn().mockResolvedValue(undefined);

  enqueueQueueHandoff.mockResolvedValue({
    branch_head: 'branch-head',
    branch_ref: 'refs/heads/review/task-1',
    outcome: null,
    ready_ref: 'refs/queue/ready/0001-review-task-1',
    state: 'waiting',
  });

  await expect(
    queueHandoffPlugin.run(
      createQueueHandoffContext({
        requestQueueWait,
        with: {
          branch: 'review/task-1',
        },
      }),
    ),
  ).resolves.toEqual({});
  expect(enqueueQueueHandoff).toHaveBeenCalledWith('/tmp/repo', {
    branch_value: 'review/task-1',
    run_id: 'run-1',
  });
  expect(requestQueueWait).toHaveBeenCalledWith({
    branch_head: 'branch-head',
    branch_ref: 'refs/heads/review/task-1',
    outcome: null,
    ready_ref: 'refs/queue/ready/0001-review-task-1',
    state: 'waiting',
  });
});

it('re-requests queue waiting when resumed before the queue entry resolves', async () => {
  const requestQueueWait = vi.fn().mockResolvedValue(undefined);

  await expect(
    queueHandoffPlugin.run(
      createQueueHandoffContext({
        queueWait: {
          branch_head: 'branch-head',
          branch_ref: 'refs/heads/review/task-1',
          outcome: null,
          ready_ref: 'refs/queue/ready/0001-review-task-1',
          state: 'waiting',
        },
        requestQueueWait,
        with: {
          branch: 'review/task-1',
        },
      }),
    ),
  ).resolves.toEqual({});
  expect(enqueueQueueHandoff).not.toHaveBeenCalled();
});

it('fails the run when the queued entry resolved with failure', async () => {
  const failRun = vi.fn().mockRejectedValue(new Error('failed queue'));

  await expect(
    queueHandoffPlugin.run(
      createQueueHandoffContext({
        failRun,
        queueWait: {
          branch_head: 'branch-head',
          branch_ref: 'refs/heads/review/task-1',
          outcome: 'failure',
          ready_ref: 'refs/queue/ready/0001-review-task-1',
          state: 'failed',
        },
        with: {
          branch: 'review/task-1',
        },
      }),
    ),
  ).rejects.toThrow('failed queue');
  expect(failRun).toHaveBeenCalledWith(
    'Queue entry "refs/queue/ready/0001-review-task-1" did not validate.',
  );
});

it('returns queue handoff details after success', async () => {
  await expect(
    queueHandoffPlugin.run(
      createQueueHandoffContext({
        queueWait: {
          branch_head: 'branch-head',
          branch_ref: 'refs/heads/review/task-1',
          outcome: 'success',
          ready_ref: 'refs/queue/ready/0001-review-task-1',
          state: 'succeeded',
        },
        with: {
          branch: 'review/task-1',
        },
      }),
    ),
  ).resolves.toEqual({
    branch: 'refs/heads/review/task-1',
    branch_head: 'branch-head',
    ready_ref: 'refs/queue/ready/0001-review-task-1',
    strategy: 'queue-handoff',
  });
});

/**
 * @param {{
 *   failRun?: CorePluginContext<QueueHandoffWith>['failRun'],
 *   queueWait?: CorePluginContext<QueueHandoffWith>['queueWait'],
 *   requestQueueWait?: CorePluginContext<QueueHandoffWith>['requestQueueWait'],
 *   with: QueueHandoffWith,
 * }} options
 * @returns {CorePluginContext<QueueHandoffWith>}
 */
function createQueueHandoffContext(options) {
  return {
    console: {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    dispatchFlow: vi.fn().mockResolvedValue({}),
    failRun:
      options.failRun ??
      vi.fn().mockRejectedValue(new Error('unexpected failRun')),
    queueWait: options.queueWait,
    repo_directory: '/tmp/repo',
    requestApproval: vi.fn().mockResolvedValue(undefined),
    requestQueueWait:
      options.requestQueueWait ??
      vi.fn().mockRejectedValue(new Error('unexpected requestQueueWait')),
    run_id: 'run-1',
    doc: {
      id: 'task-1',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
    with: options.with,
    worktree_path: '/tmp/worktree',
  };
}
