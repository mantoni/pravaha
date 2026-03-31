/** @import { ApprovalWith, CorePluginContext } from './types.ts' */
import { expect, it, vi } from 'vitest';

import approval_plugin from './approval.js';

it('logs approval details and requests approval', async () => {
  const {
    context,
    info,
    requestApproval: request_approval,
  } = createApprovalContext({
    message: 'Confirm the review handoff.',
    options: ['approve', 'reject'],
    title: 'Need approval',
  });

  await expect(approval_plugin.run(context)).resolves.toEqual({
    verdict: 'approve',
  });
  expect(info).toHaveBeenCalledTimes(3);
  expect(info).toHaveBeenNthCalledWith(1, 'Need approval');
  expect(info).toHaveBeenNthCalledWith(2, 'Confirm the review handoff.');
  expect(info).toHaveBeenNthCalledWith(3, 'Options: approve, reject');
  expect(request_approval).toHaveBeenCalledTimes(1);
});

it('skips option logging when no approval options are provided', async () => {
  const {
    context,
    info,
    requestApproval: request_approval,
  } = createApprovalContext({
    message: 'Confirm the review handoff.',
    options: [],
    title: 'Need approval',
  });

  await approval_plugin.run(context);

  expect(info).toHaveBeenCalledTimes(2);
  expect(request_approval).toHaveBeenCalledTimes(1);
});

/**
 * @param {{
 *   message: string,
 *   options: string[],
 *   title: string,
 * }} with_value
 * @returns {{
 *   context: CorePluginContext<ApprovalWith>,
 *   info: ReturnType<typeof vi.fn>,
 *   requestApproval: ReturnType<typeof vi.fn>,
 * }}
 */
function createApprovalContext(with_value) {
  const info = vi.fn();
  const requestApproval = vi.fn().mockResolvedValue(undefined);

  return {
    context: {
      console: {
        error: vi.fn(),
        info,
        log: vi.fn(),
        warn: vi.fn(),
      },
      dispatchFlow: vi.fn().mockResolvedValue({}),
      failRun: vi.fn().mockRejectedValue(new Error('unused failRun')),
      queueWait: undefined,
      repo_directory: '/tmp/repo',
      requestApproval,
      requestQueueWait: vi
        .fn()
        .mockRejectedValue(new Error('unused requestQueueWait')),
      run_id: 'run-1',
      doc: {
        id: 'task-1',
        path: 'docs/tasks/test.md',
        status: 'ready',
      },
      with: with_value,
      worktree_path: '/tmp/worktree',
    },
    info,
    requestApproval,
  };
}
