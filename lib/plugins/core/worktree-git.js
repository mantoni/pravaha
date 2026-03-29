import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execGitFile } from '../../shared/git/exec-git-file.js';

export {
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

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function assertCleanCheckout(repo_directory) {
  const { stdout } = await execGitFile(
    ['status', '--porcelain', '--untracked-files=no'],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  if (stdout.trim() !== '') {
    throw new Error('Expected the main repo checkout to be clean.');
  }
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @returns {Promise<boolean>}
 */
async function branchExists(repo_directory, branch_name) {
  try {
    await execGitFile(['rev-parse', '--verify', `refs/heads/${branch_name}`], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} temp_worktree_path
 * @returns {Promise<void>}
 */
async function cleanupTemporaryWorktree(repo_directory, temp_worktree_path) {
  try {
    await execGitFile(
      [
        '-C',
        repo_directory,
        'worktree',
        'remove',
        '--force',
        temp_worktree_path,
      ],
      {
        encoding: 'utf8',
      },
    );
  } catch {
    // Best-effort cleanup is sufficient for temporary publish worktrees.
  }

  await rm(temp_worktree_path, { force: true, recursive: true });
}

/**
 * @param {string} repo_directory
 * @param {string} target_branch
 * @param {string} run_id
 * @returns {Promise<string>}
 */
async function createTemporaryPublishWorktree(
  repo_directory,
  target_branch,
  run_id,
) {
  const temp_worktree_path = await mkdtemp(
    join(tmpdir(), `pravaha-publish-${sanitizeToken(run_id)}-`),
  );

  try {
    await execGitFile(
      [
        '-C',
        repo_directory,
        'worktree',
        'add',
        '--detach',
        temp_worktree_path,
        target_branch,
      ],
      {
        encoding: 'utf8',
      },
    );

    return temp_worktree_path;
  } catch (error) {
    await rm(temp_worktree_path, { force: true, recursive: true });
    throw error;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} target_branch
 * @param {string} target_head
 * @param {string} published_head
 * @returns {Promise<void>}
 */
async function finalizeTargetUpdate(
  repo_directory,
  target_branch,
  target_head,
  published_head,
) {
  const current_branch = await readCurrentBranch(repo_directory);

  if (current_branch === target_branch) {
    await execGitFile(['reset', '--hard', published_head], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    return;
  }

  await execGitFile(
    ['update-ref', `refs/heads/${target_branch}`, published_head, target_head],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @returns {Promise<string>}
 */
async function readBranchRevision(repo_directory, branch_name) {
  return readRevision(repo_directory, `refs/heads/${branch_name}`);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string>}
 */
async function readCurrentBranch(repo_directory) {
  const { stdout } = await execGitFile(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} left_revision
 * @param {string} right_revision
 * @returns {Promise<string>}
 */
async function readMergeBase(repo_directory, left_revision, right_revision) {
  const { stdout } = await execGitFile(
    ['merge-base', left_revision, right_revision],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
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
 * @param {string} current_branch
 * @param {string | undefined} requested_branch
 * @returns {Promise<string>}
 */
async function resolveHandoffBranch(
  repo_directory,
  current_branch,
  requested_branch,
) {
  if (requested_branch === undefined) {
    if (current_branch === 'HEAD') {
      throw new Error(
        'Expected a branch option when the worktree is not currently on a branch.',
      );
    }

    return current_branch;
  }

  if (await branchExists(repo_directory, requested_branch)) {
    throw new Error(
      `Expected worktree handoff branch "${requested_branch}" to not exist.`,
    );
  }

  return requested_branch;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeToken(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}
