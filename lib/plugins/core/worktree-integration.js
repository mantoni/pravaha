import { execGitFile } from '../../shared/git/exec-git-file.js';
import {
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
} from './worktree-git.js';

export {
  runWorktreeHandoff,
  runWorktreeMerge,
  runWorktreeRebase,
  runWorktreeSquash,
};

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {{ branch?: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runWorktreeHandoff(repo_directory, worktree_path, options) {
  await assertCleanCheckout(repo_directory);

  const worktree_head = await readRevision(worktree_path, 'HEAD');
  const current_branch = await readCurrentBranch(worktree_path);
  const branch_name = await resolveHandoffBranch(
    repo_directory,
    current_branch,
    options.branch,
  );

  await execGitFile(['switch', '--detach'], {
    cwd: worktree_path,
    encoding: 'utf8',
  });

  if (options.branch !== undefined) {
    await execGitFile(['branch', branch_name, worktree_head], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
  }

  await execGitFile(['checkout', branch_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return {
    branch: branch_name,
    strategy: 'worktree-handoff',
    worktree_head,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {string} run_id
 * @param {{ message?: string, target: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runWorktreeMerge(
  repo_directory,
  worktree_path,
  run_id,
  options,
) {
  return runWorktreePublishOperation(
    repo_directory,
    worktree_path,
    run_id,
    options.target,
    'worktree-merge',
    async (temp_worktree_path, worktree_head) => {
      await execGitFile(
        [
          'merge',
          '--no-ff',
          '--message',
          options.message ?? `Merge worktree HEAD into ${options.target}`,
          worktree_head,
        ],
        {
          cwd: temp_worktree_path,
          encoding: 'utf8',
        },
      );

      return readRevision(temp_worktree_path, 'HEAD');
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {string} run_id
 * @param {{ target: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runWorktreeRebase(
  repo_directory,
  worktree_path,
  run_id,
  options,
) {
  return runWorktreePublishOperation(
    repo_directory,
    worktree_path,
    run_id,
    options.target,
    'worktree-rebase',
    async (temp_worktree_path, worktree_head, target_head) => {
      const merge_base = await readMergeBase(
        repo_directory,
        target_head,
        worktree_head,
      );
      const commit_shas = await readRevisionList(
        repo_directory,
        `${merge_base}..${worktree_head}`,
      );

      for (const commit_sha of commit_shas) {
        await execGitFile(['cherry-pick', commit_sha], {
          cwd: temp_worktree_path,
          encoding: 'utf8',
        });
      }

      return readRevision(temp_worktree_path, 'HEAD');
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {string} run_id
 * @param {{ message?: string, target: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runWorktreeSquash(
  repo_directory,
  worktree_path,
  run_id,
  options,
) {
  return runWorktreePublishOperation(
    repo_directory,
    worktree_path,
    run_id,
    options.target,
    'worktree-squash',
    async (temp_worktree_path, worktree_head) => {
      await execGitFile(['merge', '--squash', worktree_head], {
        cwd: temp_worktree_path,
        encoding: 'utf8',
      });
      await execGitFile(
        [
          'commit',
          '--message',
          options.message ?? `Squash worktree HEAD into ${options.target}`,
        ],
        {
          cwd: temp_worktree_path,
          encoding: 'utf8',
        },
      );

      return readRevision(temp_worktree_path, 'HEAD');
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {string} run_id
 * @param {string} target_branch
 * @param {'worktree-merge' | 'worktree-rebase' | 'worktree-squash'} strategy
 * @param {(temp_worktree_path: string, worktree_head: string, target_head: string) => Promise<string>} publish_operation
 * @returns {Promise<Record<string, unknown>>}
 */
async function runWorktreePublishOperation(
  repo_directory,
  worktree_path,
  run_id,
  target_branch,
  strategy,
  publish_operation,
) {
  await assertCleanCheckout(repo_directory);

  const worktree_head = await readRevision(worktree_path, 'HEAD');
  const target_head = await readBranchRevision(repo_directory, target_branch);
  const temp_worktree_path = await createTemporaryPublishWorktree(
    repo_directory,
    target_branch,
    run_id,
  );

  try {
    const published_head = await publish_operation(
      temp_worktree_path,
      worktree_head,
      target_head,
    );

    await finalizeTargetUpdate(
      repo_directory,
      target_branch,
      target_head,
      published_head,
    );

    return {
      strategy,
      target: target_branch,
      target_head,
      target_head_after: published_head,
      worktree_head,
    };
  } finally {
    await cleanupTemporaryWorktree(repo_directory, temp_worktree_path);
  }
}
