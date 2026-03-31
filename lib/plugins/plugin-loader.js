import { constants as FS_CONSTANTS } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readCoreStepPlugin } from './core-step-plugins.js';
import { loadPravahaConfig } from '../config/load-pravaha-config.js';
import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

const DEFAULT_PLUGIN_DIRECTORY = 'plugins';

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/** @typedef {import('./plugin-contract.js').PluginDefinition<any, ZodType | undefined>} PluginDefinition */

export { loadStepPlugin };

/**
 * @param {string} repo_directory
 * @param {string} uses_value
 * @returns {Promise<{
 *   plugin: PluginDefinition,
 *   resolution: Record<string, string>,
 * }>}
 */
async function loadStepPlugin(repo_directory, uses_value) {
  const corePlugin = readCoreStepPlugin(uses_value);

  if (corePlugin !== null) {
    return {
      plugin: corePlugin,
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
    const plugin = assertValidPluginExport(module_namespace, uses_value);

    return {
      plugin,
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
    const plugin = assertValidPluginExport(module_namespace, uses_value);

    return {
      plugin,
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
  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.json_result.value === null) {
    throw new Error(
      pravaha_config_result.diagnostics[0]?.message ??
        'Cannot load pravaha.json while resolving local plugins.',
    );
  }

  if (!isPlainObject(pravaha_config_result.json_result.value)) {
    return DEFAULT_PLUGIN_DIRECTORY;
  }

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(pravaha_config_result.diagnostics[0].message);
  }

  return pravaha_config_result.config.plugin_config.dir;
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
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadModuleNamespace(module_path) {
  const module_namespace = /** @type {unknown} */ (
    await import(pathToFileURL(module_path).href)
  );

  return /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (module_namespace)
  );
}

/**
 * @param {Record<string, unknown>} module_namespace
 * @param {string} uses_value
 * @returns {PluginDefinition}
 */
function assertValidPluginExport(module_namespace, uses_value) {
  const plugin_exports = [
    ...new Set(Object.values(module_namespace).filter(isPluginExport)),
  ];

  if (plugin_exports.length === 0) {
    throw new Error(
      `Plugin "${uses_value}" must export one definePlugin(...) value.`,
    );
  }

  if (plugin_exports.length !== 1) {
    throw new Error(
      `Plugin "${uses_value}" must export exactly one definePlugin(...) value, found ${plugin_exports.length}.`,
    );
  }

  const [plugin_value] = plugin_exports;
  const branded_plugin = readCallableObject(plugin_value);

  if (branded_plugin?.[PLUGIN_CONTRACT_BRAND] !== true) {
    throw new Error(`Plugin "${uses_value}" must export definePlugin(...).`);
  }

  if (typeof branded_plugin.run !== 'function') {
    throw new Error(
      `Plugin "${uses_value}" must define an async run(context) function.`,
    );
  }

  if (branded_plugin.with !== undefined && !isZodSchema(branded_plugin.with)) {
    throw new Error(
      `Plugin "${uses_value}" must declare with as a Zod schema when present.`,
    );
  }

  return /** @type {PluginDefinition} */ (
    /** @type {unknown} */ (branded_plugin)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPluginExport(value) {
  const callable_object = readCallableObject(value);

  return callable_object?.[PLUGIN_CONTRACT_BRAND] === true;
}

/**
 * @param {unknown} schema_value
 * @returns {schema_value is ZodType}
 */
function isZodSchema(schema_value) {
  return (
    isPlainObject(schema_value) &&
    typeof schema_value.parse === 'function' &&
    typeof schema_value.safeParse === 'function'
  );
}

/**
 * @param {unknown} value
 * @returns {Record<PropertyKey, unknown> | null}
 */
function readCallableObject(value) {
  if (typeof value !== 'function' && !isPlainObject(value)) {
    return null;
  }

  return /** @type {Record<PropertyKey, unknown>} */ (value);
}

const PLUGIN_CONTRACT_BRAND = Symbol.for('pravaha.plugin_contract');

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
