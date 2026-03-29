/** @import { CorePluginContext, RunWith } from './types.ts' */
import { beforeEach, expect, it, vi } from 'vitest';

const { runShellCommand } = vi.hoisted(() => {
  return {
    runShellCommand: vi.fn(),
  };
});

vi.mock('./subprocess.js', () => {
  return {
    runShellCommand,
  };
});

const { default: run_plugin } = await import('./run.js');

beforeEach(() => {
  runShellCommand.mockReset();
});

it('returns captured stdout and stderr from shell execution', async () => {
  runShellCommand.mockResolvedValue({
    exit_code: 0,
    stderr: 'warn\n',
    stdout: 'done\n',
  });

  await expect(
    run_plugin.run({
      ...createRunContext({
        capture: ['stdout', 'stderr'],
        command: 'echo done',
      }),
    }),
  ).resolves.toEqual({
    exit_code: 0,
    stderr: 'warn\n',
    stdout: 'done\n',
  });
  expect(runShellCommand).toHaveBeenCalledWith('echo done', '/tmp/worktree');
});

it('returns only the exit code when no output capture is requested', async () => {
  runShellCommand.mockResolvedValue({
    exit_code: 0,
    stderr: 'warn\n',
    stdout: 'done\n',
  });

  await expect(
    run_plugin.run({
      ...createRunContext({
        command: 'echo done',
      }),
    }),
  ).resolves.toEqual({
    exit_code: 0,
  });
});

it('converts launch failures into result data', async () => {
  runShellCommand.mockRejectedValue(new Error('spawn failed'));

  await expect(
    run_plugin.run({
      ...createRunContext({
        capture: ['stdout', 'stderr'],
        command: 'echo done',
      }),
    }),
  ).resolves.toEqual({
    error: 'spawn failed',
    exit_code: 1,
    stderr: 'spawn failed',
    stdout: '',
  });
});

it('stringifies non-error launch failures', async () => {
  runShellCommand.mockRejectedValue('spawn failed');

  await expect(
    run_plugin.run({
      ...createRunContext({
        capture: ['stderr'],
        command: 'echo done',
      }),
    }),
  ).resolves.toEqual({
    error: 'spawn failed',
    exit_code: 1,
    stderr: 'spawn failed',
  });
});

/**
 * @param {RunWith} with_value
 * @returns {CorePluginContext<RunWith>}
 */
function createRunContext(with_value) {
  return {
    console: {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    dispatchFlow: vi.fn().mockResolvedValue({}),
    failRun: vi.fn().mockRejectedValue(new Error('unused failRun')),
    queueWait: undefined,
    repo_directory: '/tmp/repo',
    requestApproval: vi.fn().mockResolvedValue(undefined),
    requestQueueWait: vi
      .fn()
      .mockRejectedValue(new Error('unused requestQueueWait')),
    run_id: 'run-1',
    task: {
      id: 'task-1',
      path: 'docs/tasks/test.md',
      status: 'ready',
    },
    with: with_value,
    worktree_path: '/tmp/worktree',
  };
}
