import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

const CONFIG_CONTRACT_BRAND = Symbol.for('pravaha.config_contract');

/**
 * @typedef {{
 *   kind: 'repo',
 * }} RepoWorkspaceSource
 */

/**
 * @typedef {{
 *   base_ref?: string,
 *   candidate_ref?: string,
 *   dir?: string,
 *   ready_ref_prefix?: string,
 *   target_branch?: string,
 *   upstream_remote?: string,
 *   validation_flow?: string | null,
 * }} PravahaQueueConfig
 */

/**
 * @typedef {{
 *   mode: 'pooled',
 *   paths: string[],
 *   ref: string,
 *   source: RepoWorkspaceSource,
 * }} PooledWorkspaceConfig
 */

/**
 * @typedef {{
 *   base_path: string,
 *   mode: 'ephemeral',
 *   ref: string,
 *   source: RepoWorkspaceSource,
 * }} EphemeralWorkspaceConfig
 */

/**
 * @typedef {{
 *   flows?: string[],
 *   queue?: PravahaQueueConfig,
 *   workspaces?: Record<
 *     string,
 *     PooledWorkspaceConfig | EphemeralWorkspaceConfig
 *   >,
 * }} PravahaConfig
 */

export { assertValidConfig, defineConfig };

/**
 * @param {PravahaConfig} config_definition
 * @returns {PravahaConfig}
 */
function defineConfig(config_definition) {
  if (!isPlainObject(config_definition)) {
    throw new TypeError('Pravaha config must be an object.');
  }

  return Object.freeze({
    ...config_definition,
    [CONFIG_CONTRACT_BRAND]: true,
  });
}

/**
 * @param {unknown} config_value
 * @param {string} config_path
 * @returns {PravahaConfig}
 */
function assertValidConfig(config_value, config_path) {
  const branded_config = /** @type {Record<PropertyKey, unknown> | null} */ (
    isPlainObject(config_value) ? config_value : null
  );

  if (branded_config?.[CONFIG_CONTRACT_BRAND] !== true) {
    throw new Error(
      `Pravaha config module "${config_path}" must default-export defineConfig(...).`,
    );
  }

  return /** @type {PravahaConfig} */ (branded_config);
}
