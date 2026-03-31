/** @import { CorePluginContext, WorktreeHandoffWith, WorktreeMergeWith, WorktreeRebaseWith, WorktreeSquashWith } from './types.ts' */
import { access, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import worktree_handoff_plugin from './worktree-handoff.js';
import worktree_merge_plugin from './worktree-merge.js';
import worktree_rebase_plugin from './worktree-rebase.js';
import worktree_squash_plugin from './worktree-squash.js';
import { execGitFile } from '../../shared/git/exec-git-file.js';
import { prepareWorkspace } from '../../runtime/workspaces/runtime-files.js';
import { readLogSubjects, readRevision } from './test-git-helpers.js';
import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';

it('publishes the current worktree head by merge into the target branch', async () => {
  await withWorkspaceFixture(verifyWorktreeMergePlugin);
});

it('publishes the current worktree head by squash into the target branch', async () => {
  await withWorkspaceFixture(verifyWorktreeSquashPlugin);
});

it('publishes the current worktree head by rebase into the target branch', async () => {
  await withWorkspaceFixture(verifyWorktreeRebasePlugin);
});

it('keeps the worktree and target branch unchanged when publish fails', async () => {
  await withWorkspaceFixture(verifyFailedWorktreePublish);
});

it('hands the worktree head off to a named branch in the main repo', async () => {
  await withWorkspaceFixture(verifyWorktreeHandoffPlugin);
});

/**
 * @param {(fixture: {
 *   repo_directory: string,
 *   worktree_path: string,
 * }) => Promise<void>} callback
 * @returns {Promise<void>}
 */
async function withWorkspaceFixture(callback) {
  const repo_directory = await createFixtureRepo();

  try {
    const workspace_assignment = await prepareWorkspace(
      repo_directory,
      createWorkspaceDefinition(repo_directory),
    );

    await callback({
      repo_directory,
      worktree_path: workspace_assignment.path,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
}

/**
 * @param {string} repo_directory
 * @returns {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }}
 */
function createWorkspaceDefinition(repo_directory) {
  return {
    id: 'app',
    location: {
      path: join(repo_directory, '.pravaha/worktrees/implement-runtime-slice'),
    },
    mode: 'ephemeral',
    ref: 'main',
    source: {
      kind: 'repo',
    },
  };
}

/**
 * @param {{
 *   repo_directory: string,
 *   worktree_path: string,
 * }} fixture
 * @returns {Promise<void>}
 */
async function verifyWorktreeMergePlugin(fixture) {
  const worktree_head = await createWorktreeCommit(
    fixture.worktree_path,
    'merge.txt',
    'worktree merge change\n',
    'Worktree merge change',
  );

  const result = await worktree_merge_plugin.run(
    createWorktreeMergeContext(fixture.repo_directory, fixture.worktree_path, {
      message: 'Publish worktree merge',
      target: 'main',
    }),
  );
  const merge_subject = await readHeadSubject(fixture.repo_directory);

  expect(result).toMatchObject({
    strategy: 'worktree-merge',
    target: 'main',
    worktree_head,
  });
  expect(merge_subject).toBe('Publish worktree merge');
  await expect(readRevision(fixture.worktree_path, 'HEAD')).resolves.toBe(
    worktree_head,
  );
}

/**
 * @param {{
 *   repo_directory: string,
 *   worktree_path: string,
 * }} fixture
 * @returns {Promise<void>}
 */
async function verifyWorktreeSquashPlugin(fixture) {
  const worktree_head = await createWorktreeCommit(
    fixture.worktree_path,
    'squash.txt',
    'worktree squash change\n',
    'Worktree squash change',
  );

  const result = await worktree_squash_plugin.run(
    createWorktreeSquashContext(fixture.repo_directory, fixture.worktree_path, {
      message: 'Publish worktree squash',
      target: 'main',
    }),
  );
  const squash_subjects = await readLogSubjects(
    fixture.repo_directory,
    'HEAD~1..HEAD',
  );

  expect(result).toMatchObject({
    strategy: 'worktree-squash',
    target: 'main',
    worktree_head,
  });
  expect(squash_subjects).toEqual(['Publish worktree squash']);
  await expect(readRevision(fixture.worktree_path, 'HEAD')).resolves.toBe(
    worktree_head,
  );
}

/**
 * @param {{
 *   repo_directory: string,
 *   worktree_path: string,
 * }} fixture
 * @returns {Promise<void>}
 */
async function verifyWorktreeRebasePlugin(fixture) {
  await createMainRepoCommit(
    fixture.repo_directory,
    'main-before-rebase.txt',
    'main before\n',
    'Main before rebase',
  );
  const worktree_head = await createWorktreeCommit(
    fixture.worktree_path,
    'rebase.txt',
    'worktree rebase change\n',
    'Worktree rebase change',
  );
  await createMainRepoCommit(
    fixture.repo_directory,
    'main-after-rebase.txt',
    'main after\n',
    'Main after rebase',
  );

  const result = await worktree_rebase_plugin.run(
    createWorktreeRebaseContext(fixture.repo_directory, fixture.worktree_path, {
      target: 'main',
    }),
  );
  const rebased_subjects = await readLogSubjects(
    fixture.repo_directory,
    'HEAD~1..HEAD',
  );

  expect(result).toMatchObject({
    strategy: 'worktree-rebase',
    target: 'main',
    worktree_head,
  });
  expect(rebased_subjects).toEqual(['Worktree rebase change']);
  await expect(readRevision(fixture.worktree_path, 'HEAD')).resolves.toBe(
    worktree_head,
  );
}

/**
 * @param {{
 *   repo_directory: string,
 *   worktree_path: string,
 * }} fixture
 * @returns {Promise<void>}
 */
async function verifyFailedWorktreePublish(fixture) {
  await createMainRepoCommit(
    fixture.repo_directory,
    'conflict.txt',
    'main line\n',
    'Main conflict change',
  );
  const target_head = await readRevision(fixture.repo_directory, 'main');
  const worktree_head = await createWorktreeCommit(
    fixture.worktree_path,
    'conflict.txt',
    'worktree line\n',
    'Worktree conflict change',
  );
  const before_temp_entries = await readPravahaTempEntries(
    fixture.repo_directory,
  );

  await expect(
    worktree_merge_plugin.run(
      createWorktreeMergeContext(
        fixture.repo_directory,
        fixture.worktree_path,
        {
          target: 'main',
        },
      ),
    ),
  ).rejects.toThrow();

  await expect(readRevision(fixture.repo_directory, 'main')).resolves.toBe(
    target_head,
  );
  await expect(readRevision(fixture.worktree_path, 'HEAD')).resolves.toBe(
    worktree_head,
  );
  await expect(readPravahaTempEntries(fixture.repo_directory)).resolves.toEqual(
    before_temp_entries,
  );
}

/**
 * @param {{
 *   repo_directory: string,
 *   worktree_path: string,
 * }} fixture
 * @returns {Promise<void>}
 */
async function verifyWorktreeHandoffPlugin(fixture) {
  const worktree_head = await createWorktreeCommit(
    fixture.worktree_path,
    'handoff.txt',
    'handoff change\n',
    'Worktree handoff change',
  );

  const result = await worktree_handoff_plugin.run(
    createWorktreeHandoffContext(
      fixture.repo_directory,
      fixture.worktree_path,
      {
        branch: 'review/ready/task-1',
      },
    ),
  );
  const current_repo_branch = await readCurrentBranch(fixture.repo_directory);
  const current_worktree_branch = await readCurrentBranch(
    fixture.worktree_path,
  );

  expect(result).toMatchObject({
    branch: 'review/ready/task-1',
    worktree_head,
  });
  expect(current_repo_branch).toBe('review/ready/task-1');
  expect(current_worktree_branch).toBe('HEAD');
  await expect(
    readRevision(fixture.repo_directory, 'review/ready/task-1'),
  ).resolves.toBe(worktree_head);
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {WorktreeHandoffWith} with_value
 * @returns {CorePluginContext<WorktreeHandoffWith>}
 */
function createWorktreeHandoffContext(
  repo_directory,
  worktree_path,
  with_value,
) {
  return createWorktreeContext(repo_directory, worktree_path, with_value);
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {WorktreeMergeWith} with_value
 * @returns {CorePluginContext<WorktreeMergeWith>}
 */
function createWorktreeMergeContext(repo_directory, worktree_path, with_value) {
  return createWorktreeContext(repo_directory, worktree_path, with_value);
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {WorktreeRebaseWith} with_value
 * @returns {CorePluginContext<WorktreeRebaseWith>}
 */
function createWorktreeRebaseContext(
  repo_directory,
  worktree_path,
  with_value,
) {
  return createWorktreeContext(repo_directory, worktree_path, with_value);
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {WorktreeSquashWith} with_value
 * @returns {CorePluginContext<WorktreeSquashWith>}
 */
function createWorktreeSquashContext(
  repo_directory,
  worktree_path,
  with_value,
) {
  return createWorktreeContext(repo_directory, worktree_path, with_value);
}

/**
 * @template TWith
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {TWith} with_value
 * @returns {CorePluginContext<TWith>}
 */
function createWorktreeContext(repo_directory, worktree_path, with_value) {
  return {
    console: {
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
    },
    dispatchFlow: vi.fn().mockResolvedValue({}),
    failRun: vi.fn().mockRejectedValue(new Error('unused failRun')),
    queueWait: undefined,
    repo_directory,
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
 * @param {string} repo_directory
 * @param {string} file_name
 * @param {string} file_contents
 * @param {string} commit_message
 * @returns {Promise<string>}
 */
async function createMainRepoCommit(
  repo_directory,
  file_name,
  file_contents,
  commit_message,
) {
  await writeFile(join(repo_directory, file_name), file_contents, 'utf8');
  await execGitFile(['add', file_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', commit_message], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return readRevision(repo_directory, 'HEAD');
}

/**
 * @param {string} worktree_path
 * @param {string} file_name
 * @param {string} file_contents
 * @param {string} commit_message
 * @returns {Promise<string>}
 */
async function createWorktreeCommit(
  worktree_path,
  file_name,
  file_contents,
  commit_message,
) {
  await writeFile(join(worktree_path, file_name), file_contents, 'utf8');
  await execGitFile(['add', file_name], {
    cwd: worktree_path,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', commit_message], {
    cwd: worktree_path,
    encoding: 'utf8',
  });

  return readRevision(worktree_path, 'HEAD');
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string[]>}
 */
async function readPravahaTempEntries(repo_directory) {
  const temp_ref_directory = join(repo_directory, '.git/refs/pravaha');

  try {
    const entries = await access(temp_ref_directory);

    void entries;
    return ['present'];
  } catch {
    return [];
  }
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
 * @returns {Promise<string>}
 */
async function readHeadSubject(repo_directory) {
  const { stdout } = await execGitFile(
    ['log', '--format=%s', '-n', '1', 'HEAD'],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}
