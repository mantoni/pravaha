import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';

export {
  RUNTIME_DIRECTORY,
  prepareWorktree,
  updateDocumentStatus,
  writeRuntimeRecord,
};

/**
 * @param {string} repo_directory
 * @param {string} task_id
 * @returns {Promise<string>}
 */
async function prepareWorktree(repo_directory, task_id) {
  const worktree_path = join(repo_directory, WORKTREE_DIRECTORY, task_id);

  await mkdir(join(repo_directory, WORKTREE_DIRECTORY), { recursive: true });

  if (!(await pathExists(join(worktree_path, '.git')))) {
    await exec_file(
      'git',
      ['-C', repo_directory, 'worktree', 'add', '--detach', worktree_path],
      {
        encoding: 'utf8',
      },
    );
  }

  await exec_file(
    'git',
    ['-C', worktree_path, 'rev-parse', '--show-toplevel'],
    {
      encoding: 'utf8',
    },
  );

  return worktree_path;
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
