/* eslint-disable complexity */
import { isPlainObject } from './shared/diagnostics/validation-helpers.js';

const PLUGIN_CONTRACT_BRAND = Symbol.for('pravaha.plugin_contract');

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/**
 * @template TContext
 * @template {Record<string, ZodType>} TEmits
 * @template TWith
 * @typedef {{
 *   emits: TEmits,
 *   run: (context: TContext) => Promise<unknown> | unknown,
 *   with?: TWith,
 * }} PluginDefinition
 */

export {
  PLUGIN_CONTRACT_BRAND,
  assertValidPlugin,
  definePlugin,
  formatZodIssues,
  isZodSchema,
  parsePluginWithValue,
};

/**
 * @template TContext
 * @template {Record<string, ZodType>} TEmits
 * @template {ZodType | undefined} TWith
 * @param {PluginDefinition<TContext, TEmits, TWith>} plugin_definition
 * @returns {PluginDefinition<TContext, TEmits, TWith>}
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
 * @returns {PluginDefinition<any, Record<string, ZodType>, ZodType | undefined>}
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

  if (!isPlainObject(branded_plugin.emits)) {
    throw new Error(
      `Plugin "${uses_value}" must declare emits as a signal-to-schema map.`,
    );
  }

  for (const [signal_kind, signal_schema] of Object.entries(
    branded_plugin.emits,
  )) {
    if (signal_kind.trim() === '') {
      throw new Error(
        `Plugin "${uses_value}" must not declare an empty emitted signal kind.`,
      );
    }

    if (!isZodSchema(signal_schema)) {
      throw new Error(
        `Plugin "${uses_value}" must declare emits.${signal_kind} as a Zod schema.`,
      );
    }
  }

  return /** @type {PluginDefinition<any, Record<string, ZodType>, ZodType | undefined>} */ (
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
 * @param {PluginDefinition<any, Record<string, ZodType>, ZodType | undefined>} plugin_definition
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
