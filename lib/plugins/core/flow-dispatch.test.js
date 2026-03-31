import { expect, it, vi } from 'vitest';

const { flowDispatch: flowDispatchPlugin } = await import('./flow-dispatch.js');

it('dispatches nested flows through the provided core plugin context', async () => {
  const dispatchFlow = vi.fn().mockResolvedValue({
    dispatched: true,
    run_id: 'run:child',
  });

  await expect(
    flowDispatchPlugin.run({
      console: {
        error: vi.fn(),
        info: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
      },
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
      dispatchFlow,
      failRun: vi.fn(),
      repo_directory: '/repo',
      requestApproval: vi.fn(),
      requestQueueWait: vi.fn(),
      run_id: 'run:demo',
      with: {
        flow: 'docs/flows/runtime/review.js',
        inputs: {
          severity: 'high',
        },
        wait: true,
      },
      worktree_path: '/tmp/worktree',
    }),
  ).resolves.toEqual({
    dispatched: true,
    run_id: 'run:child',
  });
  expect(dispatchFlow).toHaveBeenCalledWith({
    flow: 'docs/flows/runtime/review.js',
    inputs: {
      severity: 'high',
    },
    wait: true,
  });
});
