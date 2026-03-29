/* eslint-disable max-lines-per-function */
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execGitFile } from '../shared/git/exec-git-file.js';
import {
  fetchQueueCandidate,
  fetchRefIntoQueueRepository,
  listReadyRefs,
  readNextReadyRefIndex,
  resolveQueueBaseSource,
  sanitizeReadyRefSuffix,
  updateQueueCandidateRef,
  updateValidatedQueueTip,
  writeQueueBaseSource,
} from './queue-shared.js';

export {
  allocateReadyRef,
  ensureQueueRepository,
  fetchQueueValidatedTip,
  initializeQueueRepository,
};

const QUEUE_HOOK_NAMES = ['pre-receive', 'update'];

/**
 * @param {string} repo_directory
 * @param {{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @returns {Promise<string>}
 */
async function ensureQueueRepository(repo_directory, queue_config) {
  const queue_git_dir = join(repo_directory, queue_config.dir);

  try {
    await execGitFile(['--git-dir', queue_git_dir, 'rev-parse', '--git-dir'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    return queue_git_dir;
  } catch {
    return initializeQueueRepository(repo_directory, queue_config);
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @returns {Promise<string>}
 */
async function initializeQueueRepository(repo_directory, queue_config) {
  const queue_git_dir = join(repo_directory, queue_config.dir);
  const queue_base_source = await resolveQueueBaseSource(
    repo_directory,
    queue_config,
  );

  await ensureBareQueueRepository(
    repo_directory,
    queue_git_dir,
    queue_config.target_branch,
  );
  await installQueueHooks(queue_git_dir);
  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    queue_base_source.source_ref,
    queue_config.base_ref,
  );
  await updateQueueCandidateRef(
    repo_directory,
    queue_base_source.source_ref,
    queue_config.candidate_ref,
    queue_git_dir,
  );
  await updateValidatedQueueTip(
    repo_directory,
    queue_base_source.source_ref,
    queue_config.target_branch,
    queue_git_dir,
  );
  await writeQueueBaseSource(queue_git_dir, queue_base_source.base_source);

  return queue_git_dir;
}

/**
 * @param {string} repo_directory
 * @param {string} ready_ref_prefix
 * @param {string} queue_git_dir
 * @param {string} branch_ref
 * @param {string} run_id
 * @returns {Promise<string>}
 */
async function allocateReadyRef(
  repo_directory,
  ready_ref_prefix,
  queue_git_dir,
  branch_ref,
  run_id,
) {
  const ready_refs = await listReadyRefs(queue_git_dir, ready_ref_prefix);
  const next_index = readNextReadyRefIndex(ready_refs);
  const suffix = sanitizeReadyRefSuffix(branch_ref, run_id);

  void repo_directory;

  return `${ready_ref_prefix}/${String(next_index).padStart(4, '0')}-${suffix}`;
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} target_branch
 * @returns {Promise<void>}
 */
async function fetchQueueValidatedTip(
  repo_directory,
  queue_git_dir,
  target_branch,
) {
  await fetchQueueCandidate(
    repo_directory,
    queue_git_dir,
    `refs/heads/${target_branch}`,
  );
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} target_branch
 * @returns {Promise<void>}
 */
async function ensureBareQueueRepository(
  repo_directory,
  queue_git_dir,
  target_branch,
) {
  try {
    await execGitFile(['--git-dir', queue_git_dir, 'rev-parse', '--git-dir'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    return;
  } catch {
    await execGitFile(
      ['init', '--bare', `--initial-branch=${target_branch}`, queue_git_dir],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );
  }
}

/**
 * @param {string} queue_git_dir
 * @returns {Promise<void>}
 */
async function installQueueHooks(queue_git_dir) {
  for (const hook_name of QUEUE_HOOK_NAMES) {
    const hook_path = join(queue_git_dir, 'hooks', hook_name);

    await writeFile(hook_path, createQueueHookScript(hook_name), 'utf8');
    await chmod(hook_path, 0o755);
  }
}

/**
 * @param {string} hook_name
 * @returns {string}
 */
function createQueueHookScript(hook_name) {
  return [
    '#!/usr/bin/env node',
    '',
    `const HOOK_NAME = ${JSON.stringify(hook_name)};`,
    'const ZERO_OID_PATTERN = /^0+$/u;',
    'const READY_REF_PATTERN = /^refs\\/queue\\/ready\\/\\d{4,}-[a-z0-9][a-z0-9-]*$/u;',
    "const MANAGED_PREFIXES = ['refs/heads/', 'refs/queue/candidate/', 'refs/queue/meta/'];",
    '',
    'main().catch((error) => {',
    '  const message = error instanceof Error ? error.message : String(error);',
    '  process.stderr.write(`${message}\\n`);',
    '  process.exit(1);',
    '});',
    '',
    'async function main() {',
    '  const updates = await readUpdates();',
    '  const violations = updates',
    '    .map(validateUpdate)',
    '    .filter((violation) => violation !== null);',
    '',
    '  if (violations.length === 0) {',
    '    return;',
    '  }',
    '',
    '  for (const violation of violations) {',
    '    process.stderr.write(`${violation}\\n`);',
    '  }',
    '',
    '  process.exit(1);',
    '}',
    '',
    'function validateUpdate(update) {',
    '  const { new_oid, old_oid, ref_name } = update;',
    '  const is_delete = ZERO_OID_PATTERN.test(new_oid);',
    '  const is_create = ZERO_OID_PATTERN.test(old_oid);',
    '',
    '  if (READY_REF_PATTERN.test(ref_name)) {',
    '    if (!is_create) {',
    '      return `Queue ready refs are immutable: ${ref_name}`;',
    '    }',
    '',
    '    if (is_delete) {',
    '      return `Queue ready refs must point to a commit: ${ref_name}`;',
    '    }',
    '',
    '    return null;',
    '  }',
    '',
    '  if (MANAGED_PREFIXES.some((prefix) => ref_name.startsWith(prefix))) {',
    '    return `Direct mutation of managed queue refs is not allowed: ${ref_name}`;',
    '  }',
    '',
    '  return `Unsupported queue ref update: ${ref_name}`;',
    '}',
    '',
    'async function readUpdates() {',
    "  if (HOOK_NAME === 'update') {",
    '    const [, , ref_name, old_oid, new_oid] = process.argv;',
    '',
    '    return [{ new_oid, old_oid, ref_name }];',
    '  }',
    '',
    "  process.stdin.setEncoding('utf8');",
    "  let stdin_text = '';",
    '',
    '  for await (const chunk of process.stdin) {',
    '    stdin_text += chunk;',
    '  }',
    '',
    '  return stdin_text',
    "    .split('\\n')",
    '    .map((line) => line.trim())',
    "    .filter((line) => line !== '')",
    '    .map((line) => {',
    '      const [old_oid, new_oid, ref_name] = line.split(/\\s+/u);',
    '',
    '      return { new_oid, old_oid, ref_name };',
    '    });',
    '}',
    '',
  ].join('\n');
}
