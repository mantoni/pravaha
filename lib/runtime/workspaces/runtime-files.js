/* eslint-disable max-lines */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { execGitFile } from '../../shared/git/exec-git-file.js';

const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';
export {
  createConcreteWorkspaceDefinition,
  cleanupWorkspace,
  resolveConfiguredWorkspacePaths,
  readReusableWorkspaceIdentities,
  RUNTIME_DIRECTORY,
  prepareWorkspace,
  writeRuntimeRecord,
};

/**
 * @typedef {{
 *   id?: string,
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   location?: {
 *     path: string,
 *   },
 *   source: {
 *     id?: string,
 *     ids?: string[],
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
 *   workspace_id: string,
 *   slot?: string,
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
 * @param {GitWorkspaceDefinition} workspace_definition
 * @param {string} workspace_path
 * @returns {{
 *   id: string,
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   location: {
 *     path: string,
 *   },
 *   source: {
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }}
 */
function createConcreteWorkspaceDefinition(
  workspace_definition,
  workspace_path,
) {
  return {
    id: workspace_definition.id ?? readLegacyWorkspaceId(workspace_definition),
    materialize: {
      kind: 'worktree',
      mode: workspace_definition.materialize.mode,
      ref: workspace_definition.materialize.ref,
    },
    location: {
      path: workspace_path,
    },
    source: {
      kind: 'repo',
    },
    type: 'git.workspace',
  };
}

/**
 * @param {string} repo_directory
 * @param {string} workspace_id
 * @param {Record<string, { paths: string[] }>} workspace_config
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

  return workspace_definition.paths.map((workspace_path) =>
    resolve(repo_directory, workspace_path),
  );
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string[]}
 */
function readReusableWorkspaceIdentities(workspace_definition) {
  const workspace_path = readWorkspaceLocationPath(workspace_definition);

  if (workspace_path !== null) {
    return [createReusableWorkspaceIdentity(workspace_path)];
  }

  const source_id = readLegacyWorkspaceId(workspace_definition);

  return [
    createLegacyReusableWorkspaceIdentity(
      source_id,
      workspace_definition.materialize.ref,
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
  const workspace_path = readWorkspaceLocationPath(workspace_definition);
  const workspace_id =
    workspace_definition.id ?? readLegacyWorkspaceId(workspace_definition);

  if (workspace_definition.materialize.mode === 'ephemeral') {
    const identity = `ephemeral-${task_id}-${createRuntimeToken(runtime_token)}`;

    return {
      identity,
      mode: 'ephemeral',
      path:
        workspace_path ?? join(repo_directory, WORKTREE_DIRECTORY, identity),
      ref: workspace_definition.materialize.ref,
      workspace_id,
    };
  }

  if (workspace_path !== null) {
    const identity = createReusableWorkspaceIdentity(workspace_path);

    return {
      identity,
      mode: 'pooled',
      path: workspace_path,
      ref: workspace_definition.materialize.ref,
      slot: workspace_path,
      workspace_id,
    };
  }

  const source_id = readLegacyWorkspaceId(workspace_definition);
  const identity = createLegacyReusableWorkspaceIdentity(
    source_id,
    workspace_definition.materialize.ref,
  );

  return {
    identity,
    mode: 'pooled',
    path: join(repo_directory, WORKTREE_DIRECTORY, identity),
    ref: workspace_definition.materialize.ref,
    slot: source_id,
    workspace_id,
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
 * @param {string} workspace_path
 * @returns {string}
 */
function createReusableWorkspaceIdentity(workspace_path) {
  return workspace_path;
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string | null}
 */
function readWorkspaceLocationPath(workspace_definition) {
  if (typeof workspace_definition.location?.path !== 'string') {
    return null;
  }

  if (workspace_definition.location.path.trim() === '') {
    throw new Error(
      'Expected workspace.location.path to be a non-empty string.',
    );
  }

  return workspace_definition.location.path;
}

/**
 * @param {GitWorkspaceDefinition} workspace_definition
 * @returns {string}
 */
function readLegacyWorkspaceId(workspace_definition) {
  if (typeof workspace_definition.source.id === 'string') {
    return workspace_definition.source.id;
  }

  if (
    Array.isArray(workspace_definition.source.ids) &&
    typeof workspace_definition.source.ids[0] === 'string'
  ) {
    return workspace_definition.source.ids[0];
  }

  throw new Error(
    'Expected workspace.location.path or legacy workspace source.',
  );
}

/**
 * @param {string} source_id
 * @param {string} ref
 * @returns {string}
 */
function createLegacyReusableWorkspaceIdentity(source_id, ref) {
  return `pooled-${source_id}-${createWorkspaceRefToken(ref)}`;
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
