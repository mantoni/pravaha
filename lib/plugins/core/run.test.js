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

const { run: runPlugin } = await import('./run.js');

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
    runPlugin.run({
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
    runPlugin.run({
      ...createRunContext({
        command: 'echo done',
      }),
    }),
  ).resolves.toEqual({
    exit_code: 0,
  });
});

it('fails the run when command launch fails', async () => {
  runShellCommand.mockRejectedValue(new Error('spawn failed'));
  const context = createRunContext({
    capture: ['stdout', 'stderr'],
    command: 'echo done',
  });

  await expect(runPlugin.run(context)).rejects.toThrow('spawn failed');
  expect(context.failRun).toHaveBeenCalledWith('spawn failed');
});

it('stringifies non-error launch failures', async () => {
  runShellCommand.mockRejectedValue('spawn failed');
  const context = createRunContext({
    capture: ['stderr'],
    command: 'echo done',
  });

  await expect(runPlugin.run(context)).rejects.toThrow('spawn failed');
  expect(context.failRun).toHaveBeenCalledWith('spawn failed');
});

it('returns an empty result after failRun handles a non-zero exit code', async () => {
  runShellCommand.mockResolvedValue({
    exit_code: 2,
    stderr: '',
    stdout: 'done\n',
  });
  const context = createRunContext({
    command: 'echo done',
  });
  context.failRun = vi.fn().mockResolvedValue(undefined);

  await expect(runPlugin.run(context)).resolves.toEqual({});
  expect(context.failRun).toHaveBeenCalledWith('Command exited with code 2.');
});

it('returns an empty result after failRun handles a launch error', async () => {
  runShellCommand.mockRejectedValue('spawn failed');
  const context = createRunContext({
    command: 'echo done',
  });
  context.failRun = vi.fn().mockResolvedValue(undefined);

  await expect(runPlugin.run(context)).resolves.toEqual({});
  expect(context.failRun).toHaveBeenCalledWith('spawn failed');
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
    failRun: vi.fn(
      /**
       * @param {string} errorMessage
       * @returns {Promise<never>}
       */
      (errorMessage) => Promise.reject(new Error(errorMessage)),
    ),
    queueWait: undefined,
    repo_directory: '/tmp/repo',
    requestApproval: vi.fn().mockResolvedValue(undefined),
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
  };
}
