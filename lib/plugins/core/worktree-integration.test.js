import { beforeEach, expect, it, vi } from 'vitest';

const { execGitFile } = vi.hoisted(() => {
  return {
    execGitFile: vi.fn(),
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
} = vi.hoisted(() => {
  return {
    assertCleanCheckout: vi.fn(),
    cleanupTemporaryWorktree: vi.fn(),
    createTemporaryPublishWorktree: vi.fn(),
    finalizeTargetUpdate: vi.fn(),
    readBranchRevision: vi.fn(),
    readCurrentBranch: vi.fn(),
    readMergeBase: vi.fn(),
    readRevision: vi.fn(),
    readRevisionList: vi.fn(),
    resolveHandoffBranch: vi.fn(),
  };
});

vi.mock('../../shared/git/exec-git-file.js', () => {
  return {
    execGitFile,
  };
});

vi.mock('./worktree-git.js', () => {
  return {
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
  };
});

const {
  runWorktreeHandoff,
  runWorktreeMerge,
  runWorktreeRebase,
  runWorktreeSquash,
} = await import('./worktree-integration.js');

beforeEach(() => {
  execGitFile.mockReset();
  assertCleanCheckout.mockReset();
  cleanupTemporaryWorktree.mockReset();
  createTemporaryPublishWorktree.mockReset();
  finalizeTargetUpdate.mockReset();
  readBranchRevision.mockReset();
  readCurrentBranch.mockReset();
  readMergeBase.mockReset();
  readRevision.mockReset();
  readRevisionList.mockReset();
  resolveHandoffBranch.mockReset();

  assertCleanCheckout.mockResolvedValue(undefined);
  cleanupTemporaryWorktree.mockResolvedValue(undefined);
  createTemporaryPublishWorktree.mockResolvedValue('/tmp/publish-worktree');
  finalizeTargetUpdate.mockResolvedValue(undefined);
  readBranchRevision.mockResolvedValue('target-head');
  readCurrentBranch.mockResolvedValue('feature/current');
  readMergeBase.mockResolvedValue('merge-base');
  readRevisionList.mockResolvedValue([]);
  resolveHandoffBranch.mockResolvedValue('feature/current');
});

it('hands worktree state back to the current branch when no branch is requested', async () => {
  readRevision.mockResolvedValueOnce('worktree-head');

  await expect(
    runWorktreeHandoff('/tmp/repo', '/tmp/worktree', {}),
  ).resolves.toEqual({
    branch: 'feature/current',
    strategy: 'worktree-handoff',
    worktree_head: 'worktree-head',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(1, ['switch', '--detach'], {
    cwd: '/tmp/worktree',
    encoding: 'utf8',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(
    2,
    ['checkout', 'feature/current'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('creates and checks out an explicit handoff branch', async () => {
  readRevision.mockResolvedValueOnce('worktree-head');
  resolveHandoffBranch.mockResolvedValueOnce('review/task-1');

  await expect(
    runWorktreeHandoff('/tmp/repo', '/tmp/worktree', {
      branch: 'review/task-1',
    }),
  ).resolves.toEqual({
    branch: 'review/task-1',
    strategy: 'worktree-handoff',
    worktree_head: 'worktree-head',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(
    2,
    ['branch', 'review/task-1', 'worktree-head'],
    {
      cwd: '/tmp/repo',
      encoding: 'utf8',
    },
  );
});

it('uses the default merge message for worktree publish operations', async () => {
  readRevision
    .mockResolvedValueOnce('worktree-head')
    .mockResolvedValueOnce('published-head');

  await expect(
    runWorktreeMerge('/tmp/repo', '/tmp/worktree', 'run-1', {
      target: 'main',
    }),
  ).resolves.toEqual({
    strategy: 'worktree-merge',
    target: 'main',
    target_head: 'target-head',
    target_head_after: 'published-head',
    worktree_head: 'worktree-head',
  });
  expect(execGitFile).toHaveBeenCalledWith(
    [
      'merge',
      '--no-ff',
      '--message',
      'Merge worktree HEAD into main',
      'worktree-head',
    ],
    {
      cwd: '/tmp/publish-worktree',
      encoding: 'utf8',
    },
  );
});

it('skips cherry-picks when there are no commits to replay', async () => {
  readRevision
    .mockResolvedValueOnce('worktree-head')
    .mockResolvedValueOnce('published-head');

  await expect(
    runWorktreeRebase('/tmp/repo', '/tmp/worktree', 'run-2', {
      target: 'main',
    }),
  ).resolves.toEqual({
    strategy: 'worktree-rebase',
    target: 'main',
    target_head: 'target-head',
    target_head_after: 'published-head',
    worktree_head: 'worktree-head',
  });
  expect(readMergeBase).toHaveBeenCalledWith(
    '/tmp/repo',
    'target-head',
    'worktree-head',
  );
  expect(readRevisionList).toHaveBeenCalledWith(
    '/tmp/repo',
    'merge-base..worktree-head',
  );
  expect(execGitFile).not.toHaveBeenCalled();
});

it('uses the default squash message for worktree publish operations', async () => {
  readRevision
    .mockResolvedValueOnce('worktree-head')
    .mockResolvedValueOnce('published-head');

  await expect(
    runWorktreeSquash('/tmp/repo', '/tmp/worktree', 'run-3', {
      target: 'main',
    }),
  ).resolves.toEqual({
    strategy: 'worktree-squash',
    target: 'main',
    target_head: 'target-head',
    target_head_after: 'published-head',
    worktree_head: 'worktree-head',
  });
  expect(execGitFile).toHaveBeenNthCalledWith(
    1,
    ['merge', '--squash', 'worktree-head'],
    {
      cwd: '/tmp/publish-worktree',
      encoding: 'utf8',
    },
  );
  expect(execGitFile).toHaveBeenNthCalledWith(
    2,
    ['commit', '--message', 'Squash worktree HEAD into main'],
    {
      cwd: '/tmp/publish-worktree',
      encoding: 'utf8',
    },
  );
});
