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

const exec_file = promisify(execFile);
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
      '.': './lib/pravaha.js',
      './bin/pravaha.js': './bin/pravaha.js',
    },
    files: [
      'bin/pravaha.js',
      'lib/**/*.js',
      'lib/**/*.ts',
      '!bin/**/*.test.js',
      '!bin/**/*.test-helpers.js',
      '!lib/**/*.test.js',
      '!lib/**/*.test-helpers.js',
    ],
    homepage: 'https://github.com/mantoni/pravaha',
    license: 'MIT',
    main: './lib/pravaha.js',
    peerDependencies: {
      patram: '^0.1.1',
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
  { tags: ['integration'] },
  async () => {
    const temp_directory = await createTempDirectory();

    try {
      const packed_file_paths = await listPackedFilePaths(temp_directory);

      expect(packed_file_paths).toContain('bin/pravaha.js');
      expect(packed_file_paths).toContain('lib/pravaha.js');
      expect(packed_file_paths).toContain('lib/pravaha-cli.js');
      expect(packed_file_paths).not.toContain('lib/pravaha-cli.test.js');
      expect(packed_file_paths).not.toContain('lib/create-greeting.test.js');
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
  /** @type {{ files: Array<{ path: string }> }[]} */
  const pack_results = JSON.parse(stdout);
  /** @type {string[]} */
  const packed_file_paths = pack_results[0].files.map(({ path }) => path);

  return packed_file_paths;
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
  return exec_file(command, command_arguments, {
    cwd: working_directory,
    env: {
      ...process.env,
      ...environment,
    },
  });
}
