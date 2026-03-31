import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

import { createFixtureRepoFromFiles } from './runtime-fixture.js';

export {
  REPO_DIRECTORY,
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginPackageSource,
};

const REPO_DIRECTORY = dirname(
  fileURLToPath(new URL('../../package.json', import.meta.url)),
);

/**
 * @param {{
 *   fixture_files?: Record<string, string>,
 *   pravaha_config_text?: string,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createPluginFixtureRepo(options = {}) {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-plugin-',
    options.fixture_files ?? {},
  );

  if (typeof options.pravaha_config_text === 'string') {
    await writeFile(
      join(temp_directory, 'pravaha.json'),
      options.pravaha_config_text,
    );
  }

  await linkPluginTestDependencies(temp_directory);

  return temp_directory;
}

/**
 * @param {{
 *   run_source?: string,
 *   with_source?: string,
 * }} options
 * @returns {string}
 */
function createPluginModuleSource(options) {
  const with_lines =
    typeof options.with_source === 'string'
      ? [`  with: ${options.with_source},`]
      : [];

  return [
    "import { z } from 'zod';",
    "import { definePlugin } from 'pravaha';",
    '',
    'export const plugin = definePlugin({',
    ...with_lines,
    `  async run(context) {`,
    options.run_source ?? '    void context;',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {{
 *   package_name: string,
 *   package_source: string,
 * }} options
 * @returns {Record<string, string>}
 */
function createPluginPackageSource(options) {
  return {
    [`node_modules/${options.package_name}/package.json`]: [
      '{',
      `  "name": "${options.package_name}",`,
      '  "type": "module",',
      '  "exports": "./index.js"',
      '}',
      '',
    ].join('\n'),
    [`node_modules/${options.package_name}/index.js`]: options.package_source,
  };
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function linkPluginTestDependencies(temp_directory) {
  const temp_node_modules_directory = join(temp_directory, 'node_modules');

  await mkdir(temp_node_modules_directory, { recursive: true });
  await linkDirectory(
    REPO_DIRECTORY,
    join(temp_node_modules_directory, 'pravaha'),
  );
  await linkDirectory(
    join(REPO_DIRECTORY, 'node_modules/zod'),
    join(temp_node_modules_directory, 'zod'),
  );
}

/**
 * @param {string} target_directory
 * @param {string} link_path
 * @returns {Promise<void>}
 */
async function linkDirectory(target_directory, link_path) {
  await mkdir(dirname(link_path), { recursive: true });
  await symlink(target_directory, link_path, 'dir');
}
