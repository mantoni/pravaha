import { isPlainObject } from '../shared/diagnostics/validation-helpers.js';

const PLUGIN_CONTRACT_BRAND = Symbol.for('pravaha.plugin_contract');

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/**
 * @template TContext
 * @template TWith
 * @typedef {{
 *   run: (context: TContext) => Promise<unknown> | unknown,
 *   with?: TWith,
 * }} PluginDefinition
 */

export { assertValidPlugin, definePlugin, parsePluginWithValue };

/**
 * @template TContext
 * @template {ZodType | undefined} TWith
 * @param {PluginDefinition<TContext, TWith>} plugin_definition
 * @returns {PluginDefinition<TContext, TWith>}
 */
function definePlugin(plugin_definition) {
  if (!isPlainObject(plugin_definition)) {
    throw new TypeError('Plugin definition must be an object.');
  }

  return Object.freeze({
    ...plugin_definition,
    [PLUGIN_CONTRACT_BRAND]: true,
  });
}

/**
 * @param {unknown} plugin_value
 * @param {string} uses_value
 * @returns {PluginDefinition<any, ZodType | undefined>}
 */
function assertValidPlugin(plugin_value, uses_value) {
  const branded_plugin = /** @type {Record<PropertyKey, unknown> | null} */ (
    isPlainObject(plugin_value) ? plugin_value : null
  );

  if (branded_plugin?.[PLUGIN_CONTRACT_BRAND] !== true) {
    throw new Error(
      `Plugin "${uses_value}" must default-export definePlugin(...).`,
    );
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

  return /** @type {PluginDefinition<any, ZodType | undefined>} */ (
    branded_plugin
  );
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
 * @param {PluginDefinition<any, ZodType | undefined>} plugin_definition
 * @param {string} uses_value
 * @param {unknown} with_value
 * @returns {unknown}
 */
function parsePluginWithValue(plugin_definition, uses_value, with_value) {
  if (plugin_definition.with === undefined) {
    if (with_value !== undefined) {
      throw new Error(
        `Did not expect with because plugin "${uses_value}" does not declare a with schema.`,
      );
    }

    return undefined;
  }

  const parse_result = plugin_definition.with.safeParse(with_value);

  if (!parse_result.success) {
    throw new Error(formatZodIssues(parse_result.error.issues));
  }

  return parse_result.data;
}

/**
 * @param {Array<{ message: string, path: PropertyKey[] }>} issues
 * @returns {string}
 */
function formatZodIssues(issues) {
  return issues
    .map((issue) => {
      const issue_path =
        issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';

      return `${issue_path}${issue.message}`;
    })
    .join('; ');
}
