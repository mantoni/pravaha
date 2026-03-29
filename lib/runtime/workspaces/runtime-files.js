import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { execGitFile } from '../../shared/git/exec-git-file.js';

const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';

export {
  cleanupWorkspace,
  readReusableWorkspaceIdentity,
  RUNTIME_DIRECTORY,
  prepareWorkspace,
  writeRuntimeRecord,
};

/**
 * @typedef {{
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   source: {
 *     id: string,
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }} GitWorkspaceDefinition
 */

/**
 * @typedef {{
 *   identity: string,
 *   mode: 'ephemeral' | 'pooled',
 *   path: string,
 *   ref: string,
 *   source_id: string,
 * }} WorkspaceAssignment
 */

/**
 * @param {string} repo_directory
 * @param {string} task_id
 * @param {GitWorkspaceDefinition} workspace_definition
 * @param {string} runtime_token
 * @returns {Promise<WorkspaceAssignment>}
 */
async function prepareWorkspace(
  repo_directory,
  task_id,
  workspace_definition,
  runtime_token,
) {
  const workspace_assignment = resolveWorkspaceAssignment(
    repo_directory,
    task_id,
    workspace_definition,
    runtime_token,
  );

  await mkdir(join(repo_directory, WORKTREE_DIRECTORY), { recursive: true });

  if (!(await pathExists(join(workspace_assignment.path, '.git')))) {
    await createDetachedWorktree(
      repo_directory,
      workspace_assignment.path,
      workspace_assignment.ref,
    );
  }

  await validateWorktreePath(workspace_assignment.path);

  return workspace_assignment;
}

/**
 * @param {WorkspaceAssignment} workspace_assignment
 * @returns {Promise<void>}
 */
async function cleanupWorkspace(workspace_assignment) {
  if (workspace_assignment.mode !== 'ephemeral') {
    return;
  }

  await rm(workspace_assignment.path, {
    force: true,
    recursive: true,
  });
}

/**
 * @param {string} runtime_record_path
 * @param {unknown} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecord(runtime_record_path, runtime_record) {
  await mkdir(dirname(runtime_record_path), { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string | null}
 */
function readReusableWorkspaceIdentity(workspace_definition) {
  if (workspace_definition.materialize.mode !== 'pooled') {
    return null;
  }

  return `pooled-${workspace_definition.source.id}-${createWorkspaceRefToken(workspace_definition.materialize.ref)}`;
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} task_id
 * @param {GitWorkspaceDefinition} workspace_definition
 * @param {string} runtime_token
 * @returns {WorkspaceAssignment}
 */
function resolveWorkspaceAssignment(
  repo_directory,
  task_id,
  workspace_definition,
  runtime_token,
) {
  if (workspace_definition.materialize.mode === 'ephemeral') {
    const identity = `ephemeral-${task_id}-${createRuntimeToken(runtime_token)}`;

    return {
      identity,
      mode: 'ephemeral',
      path: join(repo_directory, WORKTREE_DIRECTORY, identity),
      ref: workspace_definition.materialize.ref,
      source_id: workspace_definition.source.id,
    };
  }

  const identity = readReusableWorkspaceIdentity(workspace_definition);

  if (identity === null) {
    throw new Error('Expected pooled workspaces to resolve an identity.');
  }

  return {
    identity,
    mode: 'pooled',
    path: join(repo_directory, WORKTREE_DIRECTORY, identity),
    ref: workspace_definition.materialize.ref,
    source_id: workspace_definition.source.id,
  };
}

/**
 * @param {string} runtime_token
 * @returns {string}
 */
function createRuntimeToken(runtime_token) {
  return runtime_token.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}

/**
 * @param {string} ref
 * @returns {string}
 */
function createWorkspaceRefToken(ref) {
  return ref
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

/**
 * @param {string} repo_directory
 * @param {string} worktree_path
 * @param {string} [ref]
 * @returns {Promise<void>}
 */
async function createDetachedWorktree(repo_directory, worktree_path, ref) {
  await pruneStaleWorktrees(repo_directory);

  /** @type {string[]} */
  const git_args = [
    '-C',
    repo_directory,
    'worktree',
    'add',
    '--detach',
    worktree_path,
  ];

  if (typeof ref === 'string') {
    git_args.push(ref);
  }

  await execGitFile(git_args, {
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function pruneStaleWorktrees(repo_directory) {
  await execGitFile(
    ['-C', repo_directory, 'worktree', 'prune', '--expire', 'now'],
    {
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} worktree_path
 * @returns {Promise<void>}
 */
async function validateWorktreePath(worktree_path) {
  await execGitFile(['-C', worktree_path, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
}
