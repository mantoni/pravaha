/* eslint-disable max-lines */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { execGitFile } from '../../shared/git/exec-git-file.js';

const RUNTIME_DIRECTORY = '.pravaha/runtime';
export {
  createConcreteWorkspaceDefinition,
  createEphemeralWorkspacePath,
  cleanupWorkspace,
  resolveConfiguredWorkspacePaths,
  readReusableWorkspaceIdentities,
  RUNTIME_DIRECTORY,
  prepareWorkspace,
  writeRuntimeRecord,
};

/**
 * @typedef {{
 *   base_path: string,
 *   mode: 'ephemeral',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * } | {
 *   mode: 'pooled',
 *   paths: string[],
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }} GitWorkspaceConfigDefinition
 */

/**
 * @typedef {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral' | 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }} GitWorkspaceDefinition
 */

/**
 * @typedef {{
 *   identity: string,
 *   mode: 'ephemeral' | 'pooled',
 *   path: string,
 *   ref: string,
 *   workspace_id: string,
 *   slot?: string,
 * }} WorkspaceAssignment
 */

/**
 * @param {string} repo_directory
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {Promise<WorkspaceAssignment>}
 */
async function prepareWorkspace(repo_directory, workspace_definition) {
  const workspace_assignment = resolveWorkspaceAssignment(workspace_definition);

  await mkdir(dirname(workspace_assignment.path), { recursive: true });

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
 * @param {string} workspace_id
 * @param {GitWorkspaceConfigDefinition} workspace_definition
 * @param {string} workspace_path
 * @returns {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral' | 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }}
 */
function createConcreteWorkspaceDefinition(
  workspace_id,
  workspace_definition,
  workspace_path,
) {
  return {
    id: workspace_id,
    location: {
      path: workspace_path,
    },
    mode: workspace_definition.mode,
    ref: workspace_definition.ref,
    source: {
      kind: 'repo',
    },
  };
}

/**
 * @param {string} repo_directory
 * @param {string} workspace_id
 * @param {Record<string, GitWorkspaceConfigDefinition>} workspace_config
 * @returns {string[]}
 */
function resolveConfiguredWorkspacePaths(
  repo_directory,
  workspace_id,
  workspace_config,
) {
  const workspace_definition = workspace_config[workspace_id];

  if (workspace_definition === undefined) {
    return [];
  }

  if (workspace_definition.mode !== 'pooled') {
    return [];
  }

  return workspace_definition.paths.map((workspace_path) =>
    resolve(repo_directory, workspace_path),
  );
}

/**
 * @param {string} repo_directory
 * @param {string} workspace_id
 * @param {Record<string, GitWorkspaceConfigDefinition>} workspace_config
 * @returns {string | null}
 */
function resolveConfiguredWorkspaceBasePath(
  repo_directory,
  workspace_id,
  workspace_config,
) {
  const workspace_definition = workspace_config[workspace_id];

  if (
    workspace_definition === undefined ||
    workspace_definition.mode !== 'ephemeral'
  ) {
    return null;
  }

  return resolve(repo_directory, workspace_definition.base_path);
}

/**
 * @param {string} repo_directory
 * @param {string} workspace_id
 * @param {Record<string, GitWorkspaceConfigDefinition>} workspace_config
 * @param {string} flow_instance_id
 * @returns {string}
 */
function createEphemeralWorkspacePath(
  repo_directory,
  workspace_id,
  workspace_config,
  flow_instance_id,
) {
  const base_path = resolveConfiguredWorkspaceBasePath(
    repo_directory,
    workspace_id,
    workspace_config,
  );

  if (base_path === null) {
    throw new Error(
      `Expected workspace "${workspace_id}" to define an ephemeral base_path.`,
    );
  }

  return join(base_path, createWorkspacePathToken(flow_instance_id));
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string[]}
 */
function readReusableWorkspaceIdentities(workspace_definition) {
  return [
    createReusableWorkspaceIdentity(
      readWorkspaceLocationPath(workspace_definition),
    ),
  ];
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
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {WorkspaceAssignment}
 */
function resolveWorkspaceAssignment(workspace_definition) {
  const workspace_path = readWorkspaceLocationPath(workspace_definition);
  const identity = createReusableWorkspaceIdentity(workspace_path);

  return {
    identity,
    mode: workspace_definition.mode,
    path: workspace_path,
    ref: workspace_definition.ref,
    slot: workspace_definition.mode === 'pooled' ? workspace_path : undefined,
    workspace_id: workspace_definition.id,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function createWorkspacePathToken(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}

/**
 * @param {string} workspace_path
 * @returns {string}
 */
function createReusableWorkspaceIdentity(workspace_path) {
  return workspace_path;
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string}
 */
function readWorkspaceLocationPath(workspace_definition) {
  if (typeof workspace_definition.location?.path !== 'string') {
    throw new Error(
      'Expected workspace.location.path to be a non-empty string.',
    );
  }

  if (workspace_definition.location.path.trim() === '') {
    throw new Error(
      'Expected workspace.location.path to be a non-empty string.',
    );
  }

  return workspace_definition.location.path;
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
