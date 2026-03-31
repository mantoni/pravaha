import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import package_json from '../package.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

it('defines publish metadata for the npm package', async () => {
  expect(package_json).toMatchObject({
    description:
      'Pravaha turns human workflow into explicit contracts that agents can execute.',
    engines: {
      node: '>=22',
    },
    exports: {
      '.': {
        default: './lib/pravaha.js',
        types: './pravaha.d.ts',
      },
      './bin/pravaha.js': './bin/pravaha.js',
    },
    files: [
      'bin/pravaha.js',
      'lib/**/*.js',
      'lib/**/*.ts',
      'pravaha.d.ts',
      '!test/**',
      '!bin/**/*.test.js',
      '!bin/**/*.test-helpers.js',
      '!lib/**/*.test.js',
      '!lib/**/*.test-helpers.js',
    ],
    homepage: 'https://github.com/mantoni/pravaha',
    license: 'MIT',
    main: './lib/pravaha.js',
    dependencies: {
      patram: '^0.8.0',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/mantoni/pravaha.git',
    },
  });

  const license_text = await readTextFile(
    new URL('../LICENSE', import.meta.url),
  );

  expect(license_text).toContain('MIT License');
  expect(license_text).toContain(
    'Permission is hereby granted, free of charge',
  );
});

it(
  'excludes test artifacts from the packed npm tarball',
  { tags: ['integration', 'lint-staged-excluded'] },
  async () => {
    const temp_directory = await createTempDirectory();

    try {
      const packed_file_paths = await listPackedFilePaths(temp_directory);

      expect(packed_file_paths).toContain('bin/pravaha.js');
      expect(packed_file_paths).toContain('lib/pravaha.js');
      expect(packed_file_paths).toContain('lib/cli/main.js');
      expect(packed_file_paths).not.toContain(
        'lib/runtime-fixture-test-helpers.js',
      );
      expect(packed_file_paths).not.toContain(
        'lib/plugin.fixture-test-helpers.js',
      );
      expect(packed_file_paths).not.toContain(
        'lib/reconcile.fixture-test-helpers.js',
      );
      expect(packed_file_paths).not.toContain('lib/pravaha-cli.js');
      expect(packed_file_paths).not.toContain('lib/pravaha-cli.test.js');
      expect(packed_file_paths).not.toContain('lib/create-greeting.test.js');
      expect(packed_file_paths).not.toContain(
        'test/fixtures/runtime-fixture.js',
      );
      expect(packed_file_paths).not.toContain(
        'test/fixtures/plugin-fixture.js',
      );
      expect(packed_file_paths).not.toContain(
        'scripts/update-changelog.test.js',
      );
    } finally {
      await rm(temp_directory, { force: true, recursive: true });
    }
  },
);

/**
 * @param {URL} file_url
 * @returns {Promise<string>}
 */
async function readTextFile(file_url) {
  return readFile(file_url, 'utf8');
}

/**
 * @returns {Promise<string>}
 */
async function createTempDirectory() {
  return mkdtemp(join(tmpdir(), 'pravaha-package-metadata-'));
}

/**
 * @param {string} temp_directory
 * @returns {Promise<string[]>}
 */
async function listPackedFilePaths(temp_directory) {
  const { stdout } = await runCommand(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    repo_directory,
    {
      npm_config_cache: join(temp_directory, 'npm-cache'),
    },
  );
  return parsePackedFilePaths(stdout);
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

/**
 * @param {string} pack_results_text
 * @returns {string[]}
 */
function parsePackedFilePaths(pack_results_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(pack_results_text));

  if (!Array.isArray(parsed_value) || parsed_value.length === 0) {
    throw new Error('Expected npm pack --json to return at least one result.');
  }

  /** @type {unknown[]} */
  const pack_results = parsed_value;
  const [first_result] = pack_results;

  if (
    first_result === null ||
    typeof first_result !== 'object' ||
    Array.isArray(first_result)
  ) {
    throw new Error('Expected npm pack --json to return file metadata.');
  }

  const pack_result = /** @type {{ files?: unknown }} */ (first_result);

  if (!Array.isArray(pack_result.files)) {
    throw new Error('Expected npm pack --json to return file metadata.');
  }

  return pack_result.files.flatMap((file_entry) => {
    if (
      file_entry !== null &&
      typeof file_entry === 'object' &&
      !Array.isArray(file_entry)
    ) {
      const file_path = readObjectProperty(file_entry, 'path');

      if (typeof file_path !== 'string') {
        return [];
      }

      return [file_path];
    }

    return [];
  });
}

/**
 * @param {unknown} object_value
 * @param {string} property_name
 * @returns {unknown}
 */
function readObjectProperty(object_value, property_name) {
  if (
    object_value === null ||
    typeof object_value !== 'object' ||
    Array.isArray(object_value)
  ) {
    return undefined;
  }

  return /** @type {Record<string, unknown>} */ (object_value)[property_name];
}
