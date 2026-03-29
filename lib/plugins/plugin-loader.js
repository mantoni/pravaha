import { constants as FS_CONSTANTS } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readCoreStepPlugin } from './core-step-plugins.js';
import { assertValidPlugin } from './plugin-contract.js';
import {
  isPlainObject,
  readJsonFile,
} from '../shared/diagnostics/validation-helpers.js';

const DEFAULT_PLUGIN_DIRECTORY = 'plugins';
const PRAVAHA_CONFIG_FILENAME = 'pravaha.json';

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/** @typedef {import('./plugin-contract.js').PluginDefinition<any, ZodType | undefined>} PluginDefinition */

export { collectFlowStepPlugins, loadStepPlugin };

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} flow_definition
 * @returns {Promise<{
 *   step_plugins: Map<
 *     string,
 *     { plugin: PluginDefinition, resolution: Record<string, string> }
 *   >,
 * }>}
 */
async function collectFlowStepPlugins(repo_directory, flow_definition) {
  /** @type {Map<string, Awaited<ReturnType<typeof loadStepPlugin>>>} */
  const step_plugins = new Map();

  for (const uses_value of collectUsesValues(flow_definition)) {
    const plugin_result = await loadStepPlugin(repo_directory, uses_value);

    step_plugins.set(uses_value, plugin_result);
  }

  return {
    step_plugins,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} uses_value
 * @returns {Promise<{
 *   plugin: PluginDefinition,
 *   resolution: Record<string, string>,
 * }>}
 */
async function loadStepPlugin(repo_directory, uses_value) {
  const core_plugin = readCoreStepPlugin(uses_value);

  if (core_plugin !== null) {
    return {
      plugin: core_plugin,
      resolution: {
        kind: 'core',
        uses_value,
      },
    };
  }

  if (uses_value.startsWith('local/')) {
    const plugin_name = uses_value.slice('local/'.length);
    const dir = await readLocalPluginDir(repo_directory);
    const module_path = await resolveLocalPluginModulePath(
      repo_directory,
      dir,
      plugin_name,
      uses_value,
    );
    const module_namespace = await loadModuleNamespace(module_path);

    return {
      plugin: assertValidPlugin(module_namespace.default, uses_value),
      resolution: {
        kind: 'local',
        dir,
        module_path,
        uses_value,
      },
    };
  }

  if (uses_value.startsWith('npm/')) {
    const package_name = uses_value.slice('npm/'.length).trim();

    if (package_name === '') {
      throw new Error(
        'Expected npm plugin references to include a package name.',
      );
    }

    const requireFromRepo = createRequire(join(repo_directory, 'package.json'));
    const module_path = requireFromRepo.resolve(package_name);
    const module_namespace = await loadModuleNamespace(module_path);

    return {
      plugin: assertValidPlugin(module_namespace.default, uses_value),
      resolution: {
        kind: 'npm',
        module_path,
        package_name,
        uses_value,
      },
    };
  }

  throw new Error(`Unsupported uses step "${uses_value}".`);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string>}
 */
async function readLocalPluginDir(repo_directory) {
  const pravaha_config_result = await readJsonFile(
    join(repo_directory, PRAVAHA_CONFIG_FILENAME),
  );

  if (pravaha_config_result.value === null) {
    throw new Error(
      pravaha_config_result.diagnostics[0]?.message ??
        'Cannot load pravaha.json while resolving local plugins.',
    );
  }

  if (!isPlainObject(pravaha_config_result.value)) {
    return DEFAULT_PLUGIN_DIRECTORY;
  }

  const plugins_value = pravaha_config_result.value.plugins;

  if (plugins_value === undefined) {
    return DEFAULT_PLUGIN_DIRECTORY;
  }

  if (!isPlainObject(plugins_value)) {
    throw new Error(
      'Pravaha config plugins.dir must be a non-empty string when present.',
    );
  }

  if (plugins_value.dir === undefined) {
    return DEFAULT_PLUGIN_DIRECTORY;
  }

  if (
    typeof plugins_value.dir !== 'string' ||
    plugins_value.dir.trim() === ''
  ) {
    throw new Error(
      'Pravaha config plugins.dir must be a non-empty string when present.',
    );
  }

  return plugins_value.dir;
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @returns {Set<string>}
 */
function collectUsesValues(flow_definition) {
  /** @type {Set<string>} */
  const uses_values = new Set();

  if (!isPlainObject(flow_definition.jobs)) {
    return uses_values;
  }

  for (const job_definition of Object.values(flow_definition.jobs)) {
    if (!isPlainObject(job_definition)) {
      continue;
    }

    if (typeof job_definition.uses === 'string') {
      uses_values.add(job_definition.uses);
    }
  }

  return uses_values;
}

/**
 * @param {string} repo_directory
 * @param {string} dir
 * @param {string} plugin_name
 * @param {string} uses_value
 * @returns {Promise<string>}
 */
async function resolveLocalPluginModulePath(
  repo_directory,
  dir,
  plugin_name,
  uses_value,
) {
  if (plugin_name.trim() === '') {
    throw new Error(
      'Expected local plugin references to include a plugin name.',
    );
  }

  const candidate_paths = [
    join(repo_directory, dir, `${plugin_name}.js`),
    join(repo_directory, dir, plugin_name, 'index.js'),
  ];

  for (const candidate_path of candidate_paths) {
    if (await canReadFile(candidate_path)) {
      return candidate_path;
    }
  }

  throw new Error(`Cannot resolve plugin "${uses_value}".`);
}

/**
 * @param {string} module_path
 * @returns {Promise<{ default: unknown }>}
 */
async function loadModuleNamespace(module_path) {
  const module_namespace = /** @type {unknown} */ (
    await import(pathToFileURL(module_path).href)
  );

  return /** @type {{ default: unknown }} */ (module_namespace);
}

/**
 * @param {string} file_path
 * @returns {Promise<boolean>}
 */
async function canReadFile(file_path) {
  try {
    await access(file_path, FS_CONSTANTS.R_OK);

    return true;
  } catch {
    return false;
  }
}
