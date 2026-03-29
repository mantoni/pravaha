import { execGitFile } from '../../shared/git/exec-git-file.js';

export { runGitMerge, runGitRebase, runGitSquash };

/**
 * @param {string} worktree_path
 * @param {{ head: string, message?: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runGitMerge(worktree_path, options) {
  const operation_context = await readGitOperationContext(
    worktree_path,
    options.head,
  );
  const commit_message =
    options.message ??
    `Merge ${operation_context.head} into ${operation_context.base_ref}`;

  await execGitFile(
    ['merge', '--no-ff', '--message', commit_message, operation_context.head],
    {
      cwd: worktree_path,
      encoding: 'utf8',
    },
  );

  return createGitOperationResult(
    operation_context,
    'merge',
    await readGitRevision(worktree_path, 'HEAD'),
  );
}

/**
 * @param {string} worktree_path
 * @param {{ head: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runGitRebase(worktree_path, options) {
  const operation_context = await readGitOperationContext(
    worktree_path,
    options.head,
  );
  const commit_shas = await readRebaseCommitShas(
    worktree_path,
    operation_context.base_head,
    operation_context.head,
  );

  for (const commit_sha of commit_shas) {
    await execGitFile(['cherry-pick', commit_sha], {
      cwd: worktree_path,
      encoding: 'utf8',
    });
  }

  return createGitOperationResult(
    operation_context,
    'rebase',
    await readGitRevision(worktree_path, 'HEAD'),
  );
}

/**
 * @param {string} worktree_path
 * @param {{ head: string, message?: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runGitSquash(worktree_path, options) {
  const operation_context = await readGitOperationContext(
    worktree_path,
    options.head,
  );
  const commit_message =
    options.message ??
    `Squash ${operation_context.head} into ${operation_context.base_ref}`;

  await execGitFile(['merge', '--squash', operation_context.head], {
    cwd: worktree_path,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '--message', commit_message], {
    cwd: worktree_path,
    encoding: 'utf8',
  });

  return createGitOperationResult(
    operation_context,
    'squash',
    await readGitRevision(worktree_path, 'HEAD'),
  );
}

/**
 * @param {string} worktree_path
 * @param {string} head
 * @returns {Promise<{
 *   base_head: string,
 *   base_ref: string,
 *   head: string,
 *   head_sha: string,
 * }>}
 */
async function readGitOperationContext(worktree_path, head) {
  return {
    base_head: await readGitRevision(worktree_path, 'HEAD'),
    base_ref: await readCurrentBranch(worktree_path),
    head,
    head_sha: await readGitRevision(worktree_path, head),
  };
}

/**
 * @param {string} worktree_path
 * @param {string} base_head
 * @param {string} head
 * @returns {Promise<string[]>}
 */
async function readRebaseCommitShas(worktree_path, base_head, head) {
  const merge_base = await readGitMergeBase(worktree_path, base_head, head);

  return readGitRevisionList(worktree_path, `${merge_base}..${head}`);
}

/**
 * @param {{
 *   base_head: string,
 *   base_ref: string,
 *   head: string,
 *   head_sha: string,
 * }} operation_context
 * @param {'merge' | 'rebase' | 'squash'} strategy
 * @param {string} current_head
 * @returns {Record<string, unknown>}
 */
function createGitOperationResult(operation_context, strategy, current_head) {
  return {
    base_head: operation_context.base_head,
    base_ref: operation_context.base_ref,
    current_head,
    head: operation_context.head,
    head_sha: operation_context.head_sha,
    strategy,
  };
}

/**
 * @param {string} worktree_path
 * @returns {Promise<string>}
 */
async function readCurrentBranch(worktree_path) {
  const { stdout } = await execGitFile(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktree_path,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} worktree_path
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readGitRevision(worktree_path, revision) {
  const { stdout } = await execGitFile(['rev-parse', revision], {
    cwd: worktree_path,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} worktree_path
 * @param {string} revision_range
 * @returns {Promise<string[]>}
 */
async function readGitRevisionList(worktree_path, revision_range) {
  const { stdout } = await execGitFile(
    ['rev-list', '--reverse', revision_range],
    {
      cwd: worktree_path,
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
 * @param {string} worktree_path
 * @param {string} left_revision
 * @param {string} right_revision
 * @returns {Promise<string>}
 */
async function readGitMergeBase(worktree_path, left_revision, right_revision) {
  const { stdout } = await execGitFile(
    ['merge-base', left_revision, right_revision],
    {
      cwd: worktree_path,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}
