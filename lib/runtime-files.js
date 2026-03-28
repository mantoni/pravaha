/* eslint-disable max-lines */
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { execGitFile } from './shared/git/exec-git-file.js';

const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';

export {
  cleanupWorktree,
  cleanupWorkspace,
  RUNTIME_DIRECTORY,
  prepareWorktree,
  prepareWorkspace,
  updateDocumentStatus,
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
 * @param {{ mode: 'ephemeral' } | { mode: 'named', slot: string }} worktree_policy
 * @param {string} runtime_token
 * @returns {Promise<{
 *   identity: string,
 *   mode: 'ephemeral' | 'named',
 *   path: string,
 *   slot?: string,
 * }>}
 */
async function prepareWorktree(
  repo_directory,
  task_id,
  worktree_policy,
  runtime_token,
) {
  const worktree_assignment = resolveWorktreeAssignment(
    repo_directory,
    task_id,
    worktree_policy,
    runtime_token,
  );

  await mkdir(join(repo_directory, WORKTREE_DIRECTORY), { recursive: true });

  if (!(await pathExists(join(worktree_assignment.path, '.git')))) {
    await createDetachedWorktree(repo_directory, worktree_assignment.path);
  }

  await validateWorktreePath(worktree_assignment.path);

  return worktree_assignment;
}

/**
 * @param {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named',
 *   path: string,
 *   slot?: string,
 * }} worktree_assignment
 * @returns {Promise<void>}
 */
async function cleanupWorktree(worktree_assignment) {
  if (worktree_assignment.mode !== 'ephemeral') {
    return;
  }

  await rm(worktree_assignment.path, {
    force: true,
    recursive: true,
  });
}

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
 * @param {string} file_path
 * @param {string} current_status
 * @param {string} next_status
 * @returns {Promise<void>}
 */
async function updateDocumentStatus(file_path, current_status, next_status) {
  const document_text = await readFile(file_path, 'utf8');
  const status_pattern = /^Status:\s+(.+)$/mu;
  const match = document_text.match(status_pattern);

  if (match === null) {
    throw new Error(`Missing Status field in ${file_path}.`);
  }

  if (match[1] !== current_status) {
    throw new Error(
      `Expected ${file_path} to be ${current_status}, found ${match[1]}.`,
    );
  }

  const updated_text = document_text.replace(
    status_pattern,
    `Status: ${next_status}`,
  );

  await writeFile(file_path, updated_text);
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
 * @param {{ mode: 'ephemeral' } | { mode: 'named', slot: string }} worktree_policy
 * @param {string} runtime_token
 * @returns {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named',
 *   path: string,
 *   slot?: string,
 * }}
 */
function resolveWorktreeAssignment(
  repo_directory,
  task_id,
  worktree_policy,
  runtime_token,
) {
  if (worktree_policy.mode === 'ephemeral') {
    const identity = `ephemeral-${task_id}-${createRuntimeToken(runtime_token)}`;

    return {
      identity,
      mode: 'ephemeral',
      path: join(repo_directory, WORKTREE_DIRECTORY, identity),
    };
  }

  return {
    identity: worktree_policy.slot,
    mode: 'named',
    path: join(repo_directory, WORKTREE_DIRECTORY, worktree_policy.slot),
    slot: worktree_policy.slot,
  };
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

  const identity = `pooled-${workspace_definition.source.id}-${createWorkspaceRefToken(workspace_definition.materialize.ref)}`;

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
