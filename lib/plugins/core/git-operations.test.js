/** @import { CorePluginContext, GitMergeWith, GitRebaseWith, GitSquashWith } from './types.ts' */
import { rm, writeFile } from 'node:fs/promises';

import { expect, it, vi } from 'vitest';

import { gitMerge as git_merge_plugin } from './git-merge.js';
import { gitRebase as git_rebase_plugin } from './git-rebase.js';
import { gitSquash as git_squash_plugin } from './git-squash.js';
import { execGitFile } from '../../shared/git/exec-git-file.js';
import { readLogSubjects, readRevision } from './test-git-helpers.js';
import { createFixtureRepoFromFiles } from '../../../test/fixtures/runtime-fixture.js';

it('creates a merge commit for core/git-merge', async () => {
  await withGitRepo('pravaha-git-merge-', verifyGitMergePlugin);
});

it('creates one squashed commit for core/git-squash', async () => {
  await withGitRepo('pravaha-git-squash-', verifyGitSquashPlugin);
});

it('rebases the current branch onto the requested head for core/git-rebase', async () => {
  await withGitRepo('pravaha-git-rebase-', verifyGitRebasePlugin);
});

/**
 * @param {string} worktree_path
 * @param {GitMergeWith} with_value
 * @returns {CorePluginContext<GitMergeWith>}
 */
function createGitMergeContext(worktree_path, with_value) {
  return createBaseContext(worktree_path, with_value);
}

/**
 * @param {string} worktree_path
 * @param {GitRebaseWith} with_value
 * @returns {CorePluginContext<GitRebaseWith>}
 */
function createGitRebaseContext(worktree_path, with_value) {
  return createBaseContext(worktree_path, with_value);
}

/**
 * @param {string} worktree_path
 * @param {GitSquashWith} with_value
 * @returns {CorePluginContext<GitSquashWith>}
 */
function createGitSquashContext(worktree_path, with_value) {
  return createBaseContext(worktree_path, with_value);
}

/**
 * @template TWith
 * @param {string} worktree_path
 * @param {TWith} with_value
 * @returns {CorePluginContext<TWith>}
 */
function createBaseContext(worktree_path, with_value) {
  return {
    console: createPluginConsole(),
    dispatchFlow: vi.fn().mockResolvedValue({}),
    failRun: vi.fn().mockRejectedValue(new Error('unused failRun')),
    queueWait: undefined,
    repo_directory: worktree_path,
    requestApproval: vi.fn().mockResolvedValue(undefined),
    requestQueueWait: vi
      .fn()
      .mockRejectedValue(new Error('unused requestQueueWait')),
    run_id: 'run-1',
    doc: {
      id: 'task-1',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
    with: with_value,
    worktree_path,
  };
}

/**
 * @returns {{
 *   error: (...values: unknown[]) => void,
 *   info: (...values: unknown[]) => void,
 *   log: (...values: unknown[]) => void,
 *   warn: (...values: unknown[]) => void,
 * }}
 */
function createPluginConsole() {
  return {
    error(...values) {
      void values;
    },
    info(...values) {
      void values;
    },
    log(...values) {
      void values;
    },
    warn(...values) {
      void values;
    },
  };
}

/**
 * @param {string} repo_prefix
 * @param {(repo_directory: string) => Promise<void>} callback
 * @returns {Promise<void>}
 */
async function withGitRepo(repo_prefix, callback) {
  const repo_directory = await createFixtureRepoFromFiles(repo_prefix, {});

  try {
    await callback(repo_directory);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function verifyGitMergePlugin(repo_directory) {
  await createFeatureBranch(repo_directory, 'feature/merge', 'merge.txt', [
    ['Add merge change', 'merge change\n'],
  ]);
  const head_sha = await readRevision(repo_directory, 'feature/merge');

  await checkoutBranch(repo_directory, 'main');

  const result = await git_merge_plugin.run(
    createGitMergeContext(repo_directory, {
      head: 'feature/merge',
      message: 'Merge feature/merge into main',
    }),
  );
  const { stdout: parents_stdout } = await execGitFile(
    ['rev-list', '--parents', '-n', '1', 'HEAD'],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  expect(result).toMatchObject({
    base_ref: 'main',
    head: 'feature/merge',
    head_sha,
    strategy: 'merge',
  });
  expect(parents_stdout.trim().split(' ')).toHaveLength(3);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function verifyGitSquashPlugin(repo_directory) {
  await createFeatureBranch(repo_directory, 'feature/squash', 'squash.txt', [
    ['First squash commit', 'first\n'],
    ['Second squash commit', 'first\nsecond\n'],
  ]);
  const head_sha = await readRevision(repo_directory, 'feature/squash');

  await checkoutBranch(repo_directory, 'main');
  const base_head = await readRevision(repo_directory, 'HEAD');

  const result = await git_squash_plugin.run(
    createGitSquashContext(repo_directory, {
      head: 'feature/squash',
      message: 'Squash feature/squash into main',
    }),
  );
  const log_subjects = await readLogSubjects(
    repo_directory,
    `${base_head}..HEAD`,
  );

  expect(result).toMatchObject({
    base_ref: 'main',
    head: 'feature/squash',
    head_sha,
    strategy: 'squash',
  });
  expect(log_subjects).toEqual(['Squash feature/squash into main']);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function verifyGitRebasePlugin(repo_directory) {
  await createFeatureBranch(repo_directory, 'feature/rebase', 'rebase.txt', [
    ['Feature commit one', 'one\n'],
    ['Feature commit two', 'one\ntwo\n'],
  ]);
  await checkoutBranch(repo_directory, 'main');
  await createMainBranchCommit(repo_directory);
  await checkoutBranch(repo_directory, 'feature/rebase');
  const previous_head = await readRevision(repo_directory, 'HEAD');

  const result = await git_rebase_plugin.run(
    createGitRebaseContext(repo_directory, {
      head: 'main',
    }),
  );
  const rebased_subjects = await readLogSubjects(repo_directory, 'main..HEAD');
  const current_head = await readRevision(repo_directory, 'HEAD');

  expect(result).toMatchObject({
    base_ref: 'feature/rebase',
    current_head,
    head: 'main',
    strategy: 'rebase',
  });
  expect(rebased_subjects).toEqual([
    'Feature commit one',
    'Feature commit two',
  ]);
  expect(current_head).not.toBe(previous_head);
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {Array<[string, string]>} commits
 * @returns {Promise<void>}
 */
async function createFeatureBranch(
  repo_directory,
  branch_name,
  file_name,
  commits,
) {
  await execGitFile(['checkout', '-b', branch_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  for (const [commit_message, file_contents] of commits) {
    await writeFile(`${repo_directory}/${file_name}`, file_contents, 'utf8');
    await execGitFile(['add', file_name], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', commit_message], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
  }
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @returns {Promise<void>}
 */
async function checkoutBranch(repo_directory, branch_name) {
  await execGitFile(['checkout', branch_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function createMainBranchCommit(repo_directory) {
  await writeFile(`${repo_directory}/main.txt`, 'main branch\n', 'utf8');
  await execGitFile(['add', 'main.txt'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', 'Main branch commit'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}
