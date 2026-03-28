import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

const ACTIVE_CONTRACT_ID = 'contract:codex-sdk-happy-path';
const ACTIVE_CONTRACT_PATH = 'docs/contracts/runtime/codex-sdk-happy-path.md';
const ACTIVE_DECISION_PATH =
  'docs/decisions/runtime/codex-sdk-happy-path-backend.md';
const ACTIVE_FLOW_PATH = 'docs/flows/runtime/codex-sdk-happy-path.yaml';
const PATRAM_BIN_PATH = new URL(
  '../node_modules/patram/bin/patram.js',
  import.meta.url,
);
export {
  ACTIVE_DECISION_PATH,
  ACTIVE_CONTRACT_PATH,
  ACTIVE_FLOW_PATH,
  selectActiveContract,
  selectReadyTask,
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
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
