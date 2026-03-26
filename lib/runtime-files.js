import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { execGitFile } from './git-process.js';

const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';

export {
  cleanupWorktree,
  RUNTIME_DIRECTORY,
  prepareWorktree,
  updateDocumentStatus,
  writeRuntimeRecord,
};

/**
 * @param {string} repo_directory
 * @param {string} task_id
 * @param {{ mode: 'ephemeral' } | { mode: 'named', slot: string }} worktree_policy
 * @param {string} leased_at
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
  leased_at,
) {
  const worktree_assignment = resolveWorktreeAssignment(
    repo_directory,
    task_id,
    worktree_policy,
    leased_at,
  );

  await mkdir(join(repo_directory, WORKTREE_DIRECTORY), { recursive: true });

  if (!(await pathExists(join(worktree_assignment.path, '.git')))) {
    await execGitFile(
      [
        '-C',
        repo_directory,
        'worktree',
        'add',
        '--detach',
        worktree_assignment.path,
      ],
      {
        encoding: 'utf8',
      },
    );
  }

  await execGitFile(
    ['-C', worktree_assignment.path, 'rev-parse', '--show-toplevel'],
    {
      encoding: 'utf8',
    },
  );

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
 * @param {string} leased_at
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
  leased_at,
) {
  if (worktree_policy.mode === 'ephemeral') {
    const identity = `ephemeral-${task_id}-${createWorktreeToken(leased_at)}`;

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
 * @param {string} leased_at
 * @returns {string}
 */
function createWorktreeToken(leased_at) {
  return leased_at.toLowerCase().replaceAll(/[:.]/g, '-');
}
