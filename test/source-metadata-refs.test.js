import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

const exec_file = promisify(execFile);
const patram_bin_path = new URL(
  '../node_modules/patram/bin/patram.js',
  import.meta.url,
);
const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

it('exposes runtime decision touch-points through reverse references', async () => {
  const refs_result = await runPatramRefs(
    'docs/decisions/runtime/trigger-driven-codex-runtime.md',
  );

  expect(readIncomingPaths(refs_result, 'decided_by')).toEqual(
    expect.arrayContaining([
      'lib/reconcile.js',
      'lib/resume.js',
      'lib/run-happy-path.js',
    ]),
  );
});

it('exposes runtime contract implementation touch-points through reverse references', async () => {
  const happy_path_refs = await runPatramRefs(
    'docs/contracts/runtime/codex-sdk-happy-path.md',
  );
  const reconcile_refs = await runPatramRefs(
    'docs/contracts/runtime/single-task-flow-reconciler.md',
  );
  const resume_refs = await runPatramRefs(
    'docs/contracts/runtime/strict-runtime-resume.md',
  );

  expect(readIncomingPaths(happy_path_refs, 'implements')).toContain(
    'lib/run-happy-path.js',
  );
  expect(readIncomingPaths(reconcile_refs, 'implements')).toContain(
    'lib/reconcile.js',
  );
  expect(readIncomingPaths(resume_refs, 'implements')).toEqual(
    expect.arrayContaining([
      'lib/resume.js',
      'lib/runtime-attempt-records.js',
      'lib/runtime-records.js',
    ]),
  );
});

/**
 * @param {string} relative_path
 * @returns {Promise<{
 *   incoming?: Record<string, Array<{ '$path'?: string }>>,
 * }>}
 */
async function runPatramRefs(relative_path) {
  const { stdout } = await exec_file(
    process.execPath,
    [patram_bin_path.pathname, 'refs', relative_path, '--json'],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return JSON.parse(stdout);
}

/**
 * @param {{
 *   incoming?: Record<string, Array<{ '$path'?: string }>>,
 * }} refs_result
 * @param {string} relation_name
 * @returns {string[]}
 */
function readIncomingPaths(refs_result, relation_name) {
  const incoming_nodes = refs_result.incoming?.[relation_name] ?? [];

  return incoming_nodes
    .map((incoming_node) => incoming_node.$path)
    .filter(
      /**
       * @param {string | undefined} incoming_path
       * @returns {incoming_path is string}
       */
      (incoming_path) => typeof incoming_path === 'string',
    )
    .sort(compare_text);
}

/**
 * @param {string} left_text
 * @param {string} right_text
 * @returns {number}
 */
function compare_text(left_text, right_text) {
  return left_text.localeCompare(right_text, 'en');
}
