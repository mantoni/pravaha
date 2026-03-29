import { beforeEach, expect, it, vi } from 'vitest';

const { execGitFile } = vi.hoisted(() => {
  return {
    execGitFile: vi.fn(),
  };
});

vi.mock('../../shared/git/exec-git-file.js', () => {
  return {
    execGitFile,
  };
});

const { runGitMerge, runGitSquash } = await import('./git-integration.js');

beforeEach(() => {
  execGitFile.mockReset();
});

it('uses the default merge commit message when one is not provided', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'base-head\n' })
    .mockResolvedValueOnce({ stdout: 'main\n' })
    .mockResolvedValueOnce({ stdout: 'feature-head\n' })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ stdout: 'merged-head\n' });

  await expect(
    runGitMerge('/tmp/worktree', { head: 'feature/task-1' }),
  ).resolves.toEqual({
    base_head: 'base-head',
    base_ref: 'main',
    current_head: 'merged-head',
    head: 'feature/task-1',
    head_sha: 'feature-head',
    strategy: 'merge',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(
    4,
    [
      'merge',
      '--no-ff',
      '--message',
      'Merge feature/task-1 into main',
      'feature/task-1',
    ],
    {
      cwd: '/tmp/worktree',
      encoding: 'utf8',
    },
  );
});

it('uses the default squash commit message when one is not provided', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'base-head\n' })
    .mockResolvedValueOnce({ stdout: 'main\n' })
    .mockResolvedValueOnce({ stdout: 'feature-head\n' })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ stdout: 'squashed-head\n' });

  await expect(
    runGitSquash('/tmp/worktree', { head: 'feature/task-2' }),
  ).resolves.toEqual({
    base_head: 'base-head',
    base_ref: 'main',
    current_head: 'squashed-head',
    head: 'feature/task-2',
    head_sha: 'feature-head',
    strategy: 'squash',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(
    5,
    ['commit', '--message', 'Squash feature/task-2 into main'],
    {
      cwd: '/tmp/worktree',
      encoding: 'utf8',
    },
  );
});
