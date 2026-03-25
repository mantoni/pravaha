import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

const ACTIVE_CONTRACT_ID = 'contract:codex-sdk-happy-path';
const ACTIVE_CONTRACT_PATH = 'docs/contracts/runtime/codex-sdk-happy-path.md';
const ACTIVE_DECISION_PATH =
  'docs/decisions/runtime/codex-sdk-happy-path-backend.md';
const ACTIVE_FLOW_PATH = 'docs/flows/runtime/codex-sdk-happy-path.md';
const PATRAM_BIN_PATH = new URL(
  '../node_modules/patram/bin/patram.js',
  import.meta.url,
);
const RUNTIME_DIRECTORY = '.pravaha/runtime';
const WORKTREE_DIRECTORY = '.pravaha/worktrees';

export {
  ACTIVE_CONTRACT_PATH,
  ACTIVE_FLOW_PATH,
  RUNTIME_DIRECTORY,
  selectActiveContract,
  selectReadyTask,
  prepareWorktree,
  createDeterministicPrompt,
  writeRuntimeRecord,
  updateDocumentStatus,
};

/**
 * @param {string} repo_directory
 * @returns {Promise<{ contract_path: string, root_flow_path: string }>}
 */
async function selectActiveContract(repo_directory) {
  const query_result = await runPatramCommand(repo_directory, [
    'query',
    'active-contracts',
    '--json',
  ]);
  const contract_result = query_result.results.find(
    /**
     * @param {{ '$id'?: string, '$path'?: string }} result
     * @returns {boolean}
     */
    (result) =>
      result.$id === ACTIVE_CONTRACT_ID &&
      result.$path === ACTIVE_CONTRACT_PATH,
  );

  if (contract_result === undefined) {
    throw new Error(
      `Missing active contract ${ACTIVE_CONTRACT_PATH} for the happy-path runtime.`,
    );
  }

  const contract_text = await readFile(
    join(repo_directory, ACTIVE_CONTRACT_PATH),
    'utf8',
  );
  const root_flow_path = readFrontMatterValue(contract_text, 'Root flow');

  if (root_flow_path !== ACTIVE_FLOW_PATH) {
    throw new Error(
      `Expected ${ACTIVE_CONTRACT_PATH} to bind ${ACTIVE_FLOW_PATH}, found ${root_flow_path}.`,
    );
  }

  return {
    contract_path: ACTIVE_CONTRACT_PATH,
    root_flow_path,
  };
}

/**
 * @param {string} repo_directory
 * @returns {Promise<{ task_id: string, task_path: string }>}
 */
async function selectReadyTask(repo_directory) {
  const query_result = await runPatramCommand(repo_directory, [
    'query',
    '--where',
    '$class=task and tracked_in=contract:codex-sdk-happy-path and status=ready and none(out:depends_on, status not in [done, dropped])',
    '--json',
  ]);

  if (query_result.results.length !== 1) {
    throw new Error(
      `Expected exactly one ready task for ${ACTIVE_CONTRACT_ID}, found ${query_result.results.length}.`,
    );
  }

  const [task_result] = query_result.results;

  if (
    typeof task_result.$id !== 'string' ||
    typeof task_result.$path !== 'string'
  ) {
    throw new Error('Patram returned an invalid ready task record.');
  }

  return {
    task_id: task_result.$id.replace(/^task:/u, ''),
    task_path: task_result.$path,
  };
}

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
 * @param {string} repo_directory
 * @param {string} task_path
 * @returns {Promise<string>}
 */
async function createDeterministicPrompt(repo_directory, task_path) {
  const contract_text = await readFile(
    join(repo_directory, ACTIVE_CONTRACT_PATH),
    'utf8',
  );
  const decision_text = await readFile(
    join(repo_directory, ACTIVE_DECISION_PATH),
    'utf8',
  );
  const flow_text = await readFile(
    join(repo_directory, ACTIVE_FLOW_PATH),
    'utf8',
  );
  const task_text = await readFile(join(repo_directory, task_path), 'utf8');

  return [
    'You are executing the Pravaha Codex SDK happy-path runtime slice.',
    'Operate only in the provided working directory.',
    'Do not edit repository files in this slice.',
    'Return JSON with a single "summary" string.',
    '',
    `Contract document (${ACTIVE_CONTRACT_PATH}):`,
    contract_text.trimEnd(),
    '',
    `Decision document (${ACTIVE_DECISION_PATH}):`,
    decision_text.trimEnd(),
    '',
    `Root flow document (${ACTIVE_FLOW_PATH}):`,
    flow_text.trimEnd(),
    '',
    `Task document (${task_path}):`,
    task_text.trimEnd(),
    '',
  ].join('\n');
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
 * @param {string} repo_directory
 * @param {string[]} command_arguments
 * @returns {Promise<{ results: Array<{ '$id'?: string, '$path'?: string }> }>}
 */
async function runPatramCommand(repo_directory, command_arguments) {
  const { stdout } = await exec_file(
    process.execPath,
    [PATRAM_BIN_PATH.pathname, ...command_arguments],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return JSON.parse(stdout);
}

/**
 * @param {string} document_text
 * @param {string} label
 * @returns {string}
 */
function readFrontMatterValue(document_text, label) {
  const label_pattern = new RegExp(`^${escapeRegExp(label)}:\\s+(.+)$`, 'mu');
  const match = document_text.match(label_pattern);

  if (match === null) {
    throw new Error(`Missing ${label} metadata.`);
  }

  return match[1];
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await readFile(path, 'utf8');

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
