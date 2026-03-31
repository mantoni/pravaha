// @module-tag smoke
// @module-tag lint-staged-excluded

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { it } from 'vitest';

const execFileAsync = promisify(execFile);
const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

it('installs and imports the packed npm package in a consumer project', async () => {
  const temp_directory = await createTempDirectory();

  try {
    const tarball_path = await packRepo(temp_directory);
    const consumer_directory = join(temp_directory, 'consumer');

    await createConsumerProject(consumer_directory);
    await installTarball(consumer_directory, tarball_path);
    await importPackedLibrary(consumer_directory);
    await importPackedFlowLibrary(consumer_directory);
    await importPackedCli(consumer_directory);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} parent_directory
 * @returns {Promise<string>}
 */
async function packRepo(parent_directory) {
  const npm_cache_directory = join(parent_directory, 'npm-cache');

  await mkdir(npm_cache_directory, { recursive: true });

  const { stdout } = await runCommand(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      parent_directory,
    ],
    repo_directory,
    {
      npm_config_cache: npm_cache_directory,
    },
  );
  const pack_result = parsePackResult(stdout);

  return join(parent_directory, pack_result.filename);
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function createConsumerProject(consumer_directory) {
  await mkdir(consumer_directory, { recursive: true });

  const package_json_path = join(consumer_directory, 'package.json');
  const package_json_text = JSON.stringify(
    {
      name: 'pravaha-smoke-test-consumer',
      private: true,
      type: 'module',
    },
    null,
    2,
  );

  await writeFile(package_json_path, `${package_json_text}\n`);
}

/**
 * @param {string} consumer_directory
 * @param {string} tarball_path
 * @returns {Promise<void>}
 */
async function installTarball(consumer_directory, tarball_path) {
  const npm_cache_directory = join(consumer_directory, '.npm-cache');

  await mkdir(npm_cache_directory, { recursive: true });

  await runCommand(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', tarball_path],
    consumer_directory,
    {
      npm_config_cache: npm_cache_directory,
    },
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedCli(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      "await import('./node_modules/pravaha/bin/pravaha.js')",
    ],
    consumer_directory,
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedLibrary(consumer_directory) {
  await runCommand(
    'node',
    ['--input-type=module', '--eval', ["await import('pravaha');"].join('\n')],
    consumer_directory,
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedFlowLibrary(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      ["await import('pravaha/flow');"].join('\n'),
    ],
    consumer_directory,
  );
}

/**
 * @returns {Promise<string>}
 */
async function createTempDirectory() {
  return mkdtemp(join(tmpdir(), 'pravaha-package-install-'));
}

/**
 * @param {string} pack_result_text
 * @returns {{ filename: string }}
 */
function parsePackResult(pack_result_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(pack_result_text));

  if (!Array.isArray(parsed_value) || parsed_value.length === 0) {
    throw new Error('Expected npm pack to return at least one result.');
  }

  /** @type {unknown[]} */
  const parsed_results = parsed_value;
  const [first_result] = parsed_results;

  if (
    first_result === null ||
    typeof first_result !== 'object' ||
    Array.isArray(first_result)
  ) {
    throw new Error('Expected npm pack to return a filename.');
  }

  const pack_result = /** @type {{ filename?: unknown }} */ (first_result);

  if (typeof pack_result.filename !== 'string') {
    throw new Error('Expected npm pack to return a filename.');
  }

  return /** @type {{ filename: string }} */ (pack_result);
}

/**
 * @param {string} command
 * @param {string[]} command_arguments
 * @param {string} working_directory
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runCommand(
  command,
  command_arguments,
  working_directory,
  environment,
) {
  return execFileAsync(command, command_arguments, {
    cwd: working_directory,
    env: {
      ...process.env,
      ...environment,
    },
  });
}
