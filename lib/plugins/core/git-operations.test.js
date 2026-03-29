/** @import { CorePluginContext, GitMergeWith, GitRebaseWith, GitSquashWith } from './types.ts' */
import { rm, writeFile } from 'node:fs/promises';

import { expect, it, vi } from 'vitest';

import git_merge_plugin from './git-merge.js';
import git_rebase_plugin from './git-rebase.js';
import git_squash_plugin from './git-squash.js';
import { execGitFile } from '../../shared/git/exec-git-file.js';
import { createFixtureRepoFromFiles } from '../../../test/fixtures/runtime-fixture.js';

it('creates a merge commit for core/git-merge', async () => {
  await verifyGitMergePlugin();
});

it('creates one squashed commit for core/git-squash', async () => {
  await verifyGitSquashPlugin();
});

it('rebases head commits onto the current branch for core/git-rebase', async () => {
  await verifyGitRebasePlugin();
});

/**
 * @param {string} worktree_path
 * @param {GitMergeWith} with_value
 * @returns {CorePluginContext<GitMergeWith>}
 */
function createGitContext(worktree_path, with_value) {
  return createBaseContext(worktree_path, with_value);
}

/**
 * @param {string} worktree_path
 * @param {GitRebaseWith} with_value
 * @returns {CorePluginContext<GitRebaseWith>}
 */
function createRebaseContext(worktree_path, with_value) {
  return createBaseContext(worktree_path, with_value);
}

/**
 * @param {string} worktree_path
 * @param {GitSquashWith} with_value
 * @returns {CorePluginContext<GitSquashWith>}
 */
function createSquashContext(worktree_path, with_value) {
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
    console: {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    dispatchFlow: vi.fn().mockResolvedValue({}),
    repo_directory: worktree_path,
    requestApproval: vi.fn().mockResolvedValue(undefined),
    run_id: 'run-1',
    task: {
      id: 'task-1',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
    with: with_value,
    worktree_path,
  };
}

/**
 * @returns {Promise<void>}
 */
async function verifyGitMergePlugin() {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-git-merge-',
    {},
  );

  try {
    await createFeatureBranch(temp_directory, 'feature/merge', 'merge.txt', [
      ['Add merge change', 'merge change\n'],
    ]);
    const head_sha = await readRevision(temp_directory, 'feature/merge');

    await checkoutMain(temp_directory);

    const result = await git_merge_plugin.run(
      createGitContext(temp_directory, {
        head: 'feature/merge',
        message: 'Merge feature/merge into main',
      }),
    );
    const { stdout: parents_stdout } = await execGitFile(
      ['rev-list', '--parents', '-n', '1', 'HEAD'],
      {
        cwd: temp_directory,
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
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @returns {Promise<void>}
 */
async function verifyGitSquashPlugin() {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-git-squash-',
    {},
  );

  try {
    await createFeatureBranch(temp_directory, 'feature/squash', 'squash.txt', [
      ['First squash commit', 'first\n'],
      ['Second squash commit', 'first\nsecond\n'],
    ]);
    const head_sha = await readRevision(temp_directory, 'feature/squash');

    await checkoutMain(temp_directory);
    const base_head = await readRevision(temp_directory, 'HEAD');

    const result = await git_squash_plugin.run(
      createSquashContext(temp_directory, {
        head: 'feature/squash',
        message: 'Squash feature/squash into main',
      }),
    );
    const { stdout: log_subjects_stdout } = await execGitFile(
      ['log', '--format=%s', '--reverse', `${base_head}..HEAD`],
      {
        cwd: temp_directory,
        encoding: 'utf8',
      },
    );

    expect(result).toMatchObject({
      base_ref: 'main',
      head: 'feature/squash',
      head_sha,
      strategy: 'squash',
    });
    expect(log_subjects_stdout.trim().split('\n')).toEqual([
      'Squash feature/squash into main',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @returns {Promise<void>}
 */
async function verifyGitRebasePlugin() {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-git-rebase-',
    {},
  );

  try {
    await createFeatureBranch(temp_directory, 'feature/rebase', 'rebase.txt', [
      ['Feature commit one', 'one\n'],
      ['Feature commit two', 'one\ntwo\n'],
    ]);
    const feature_shas = await readRevisionList(
      temp_directory,
      'main..feature/rebase',
    );
    const head_sha = await readRevision(temp_directory, 'feature/rebase');

    await checkoutMain(temp_directory);
    await createMainBranchCommit(temp_directory);

    const result = await git_rebase_plugin.run(
      createRebaseContext(temp_directory, {
        head: 'feature/rebase',
      }),
    );
    const rebased_subjects = await readLogSubjects(
      temp_directory,
      'HEAD~2..HEAD',
    );
    const rebased_shas = await readRevisionList(temp_directory, 'HEAD~2..HEAD');

    expect(result).toMatchObject({
      base_ref: 'main',
      head: 'feature/rebase',
      head_sha,
      strategy: 'rebase',
    });
    expect(rebased_subjects).toEqual([
      'Feature commit one',
      'Feature commit two',
    ]);
    expect(rebased_shas).not.toEqual(feature_shas);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
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
 * @returns {Promise<void>}
 */
async function checkoutMain(repo_directory) {
  await execGitFile(['checkout', 'main'], {
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

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(['rev-parse', revision], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} revision_range
 * @returns {Promise<string[]>}
 */
async function readRevisionList(repo_directory, revision_range) {
  const { stdout } = await execGitFile(
    ['rev-list', '--reverse', revision_range],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
  const trimmed_stdout = stdout.trim();

  if (trimmed_stdout === '') {
    return [];
  }

  return trimmed_stdout.split('\n');
}

/**
 * @param {string} repo_directory
 * @param {string} revision_range
 * @returns {Promise<string[]>}
 */
async function readLogSubjects(repo_directory, revision_range) {
  const { stdout } = await execGitFile(
    ['log', '--format=%s', '--reverse', revision_range],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
  const trimmed_stdout = stdout.trim();

  if (trimmed_stdout === '') {
    return [];
  }

  return trimmed_stdout.split('\n');
}
