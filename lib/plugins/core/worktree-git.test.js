import { beforeEach, expect, it, vi } from 'vitest';

const { execGitFile, mkdtemp, rm } = vi.hoisted(() => {
  return {
    execGitFile: vi.fn(),
    mkdtemp: vi.fn(),
    rm: vi.fn(),
  };
});

vi.mock('../../shared/git/exec-git-file.js', () => {
  return {
    execGitFile,
  };
});

vi.mock('node:fs/promises', () => {
  return {
    mkdtemp,
    rm,
  };
});

const {
  assertCleanCheckout,
  cleanupTemporaryWorktree,
  createTemporaryPublishWorktree,
  finalizeTargetUpdate,
  readBranchRevision,
  readCurrentBranch,
  readMergeBase,
  readRevision,
  readRevisionList,
  resolveHandoffBranch,
} = await import('./worktree-git.js');

beforeEach(() => {
  execGitFile.mockReset();
  mkdtemp.mockReset();
  rm.mockReset();
  rm.mockResolvedValue(undefined);
});

it('accepts a clean checkout', async () => {
  execGitFile.mockResolvedValueOnce({ stdout: '\n' });

  await expect(assertCleanCheckout('/tmp/repo')).resolves.toBeUndefined();
  expect(execGitFile).toHaveBeenCalledWith(
    ['status', '--porcelain', '--untracked-files=no'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('rejects a dirty checkout', async () => {
  execGitFile.mockResolvedValueOnce({ stdout: ' M lib/file.js\n' });

  await expect(assertCleanCheckout('/tmp/repo')).rejects.toThrow(
    'Expected the main repo checkout to be clean.',
  );
});

it('removes the temporary worktree path even when git cleanup fails', async () => {
  execGitFile.mockRejectedValueOnce(new Error('remove failed'));

  await expect(
    cleanupTemporaryWorktree('/tmp/repo', '/tmp/worktree'),
  ).resolves.toBeUndefined();
  expect(execGitFile).toHaveBeenCalledWith(
    ['-C', '/tmp/repo', 'worktree', 'remove', '--force', '/tmp/worktree'],
    {
      encoding: 'utf8',
    },
  );
  expect(rm).toHaveBeenCalledWith('/tmp/worktree', {
    force: true,
    recursive: true,
  });
});

it('creates a detached publish worktree using a sanitized run id', async () => {
  mkdtemp.mockResolvedValueOnce('/tmp/pravaha-publish-run-1');
  execGitFile.mockResolvedValueOnce({});

  await expect(
    createTemporaryPublishWorktree('/tmp/repo', 'main', 'Run 1'),
  ).resolves.toBe('/tmp/pravaha-publish-run-1');
  expect(mkdtemp).toHaveBeenCalledWith(
    expect.stringContaining('pravaha-publish-run-1-'),
  );
  expect(execGitFile).toHaveBeenCalledWith(
    [
      '-C',
      '/tmp/repo',
      'worktree',
      'add',
      '--detach',
      '/tmp/pravaha-publish-run-1',
      'main',
    ],
    {
      encoding: 'utf8',
    },
  );
});

it('cleans up the temporary path when worktree creation fails', async () => {
  const failure = new Error('add failed');

  mkdtemp.mockResolvedValueOnce('/tmp/pravaha-publish-run-2');
  execGitFile.mockRejectedValueOnce(failure);

  await expect(
    createTemporaryPublishWorktree('/tmp/repo', 'release', 'run 2'),
  ).rejects.toThrow('add failed');
  expect(rm).toHaveBeenCalledWith('/tmp/pravaha-publish-run-2', {
    force: true,
    recursive: true,
  });
});

it('hard-resets the target branch when it is currently checked out', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'main\n' })
    .mockResolvedValueOnce({});

  await expect(
    finalizeTargetUpdate('/tmp/repo', 'main', 'old-head', 'new-head'),
  ).resolves.toBeUndefined();
  expect(execGitFile).toHaveBeenNthCalledWith(
    2,
    ['reset', '--hard', 'new-head'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('updates the target ref when another branch is checked out', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'feature/task-1\n' })
    .mockResolvedValueOnce({});

  await expect(
    finalizeTargetUpdate('/tmp/repo', 'main', 'old-head', 'new-head'),
  ).resolves.toBeUndefined();
  expect(execGitFile).toHaveBeenNthCalledWith(
    2,
    ['update-ref', 'refs/heads/main', 'new-head', 'old-head'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('reads branch revisions and trims branch names, merge bases, and revisions', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'branch-head\n' })
    .mockResolvedValueOnce({ stdout: 'main\n' })
    .mockResolvedValueOnce({ stdout: 'merge-base\n' })
    .mockResolvedValueOnce({ stdout: 'revision-head\n' });

  await expect(readBranchRevision('/tmp/repo', 'main')).resolves.toBe(
    'branch-head',
  );
  await expect(readCurrentBranch('/tmp/repo')).resolves.toBe('main');
  await expect(readMergeBase('/tmp/repo', 'left', 'right')).resolves.toBe(
    'merge-base',
  );
  await expect(readRevision('/tmp/repo', 'HEAD')).resolves.toBe(
    'revision-head',
  );
});

it('returns revision lists and handles empty ranges', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'one\ntwo\n' })
    .mockResolvedValueOnce({ stdout: '\n' });

  await expect(readRevisionList('/tmp/repo', 'base..head')).resolves.toEqual([
    'one',
    'two',
  ]);
  await expect(readRevisionList('/tmp/repo', 'head..head')).resolves.toEqual(
    [],
  );
});

it('reuses the current branch when no handoff branch is requested', async () => {
  await expect(
    resolveHandoffBranch('/tmp/repo', 'feature/task-1', undefined),
  ).resolves.toBe('feature/task-1');
  expect(execGitFile).not.toHaveBeenCalled();
});

it('rejects detached-head handoff without an explicit branch name', async () => {
  await expect(
    resolveHandoffBranch('/tmp/repo', 'HEAD', undefined),
  ).rejects.toThrow(
    'Expected a branch option when the worktree is not currently on a branch.',
  );
});

it('rejects an explicit handoff branch when it already exists', async () => {
  execGitFile.mockResolvedValueOnce({});

  await expect(
    resolveHandoffBranch('/tmp/repo', 'main', 'review/task-1'),
  ).rejects.toThrow(
    'Expected worktree handoff branch "review/task-1" to not exist.',
  );
  expect(execGitFile).toHaveBeenCalledWith(
    ['rev-parse', '--verify', 'refs/heads/review/task-1'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('accepts an explicit handoff branch when it does not exist yet', async () => {
  execGitFile.mockRejectedValueOnce(new Error('missing'));

  await expect(
    resolveHandoffBranch('/tmp/repo', 'main', 'review/task-2'),
  ).resolves.toBe('review/task-2');
});
