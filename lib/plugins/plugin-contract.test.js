/* eslint-disable max-lines-per-function */
import { z } from 'zod';
import { expect, it } from 'vitest';

import {
  assertValidPlugin,
  definePlugin,
  parsePluginWithValue,
} from './plugin-contract.js';

it('defines and validates branded plugins and parses with values', () => {
  const plugin_definition = definePlugin({
    async run(context) {
      void context;
    },
    with: z.object({
      reviewer: z.string(),
    }),
  });

  expect(Object.isFrozen(plugin_definition)).toBe(true);
  expect(assertValidPlugin(plugin_definition, 'local/review')).toBe(
    plugin_definition,
  );
  expect(
    parsePluginWithValue(plugin_definition, 'local/review', {
      reviewer: 'max',
    }),
  ).toEqual({
    reviewer: 'max',
  });
});

it('rejects invalid plugin definitions and invalid with values', () => {
  expect(() => definePlugin(/** @type {never} */ (null))).toThrow(
    'Plugin definition must be an object.',
  );
  expect(() => assertValidPlugin({}, 'local/review')).toThrow(
    'Plugin "local/review" must default-export definePlugin(...).',
  );
  expect(() =>
    assertValidPlugin(
      definePlugin({
        run: /** @type {never} */ (undefined),
      }),
      'local/review',
    ),
  ).toThrow('must define an async run(context) function');
  expect(() =>
    assertValidPlugin(
      definePlugin({
        async run(context) {
          void context;
        },
        with: /** @type {never} */ ({ parse: true }),
      }),
      'local/review',
    ),
  ).toThrow('must declare with as a Zod schema when present');
  expect(
    parsePluginWithValue(
      definePlugin({
        async run(context) {
          void context;
        },
      }),
      'local/review',
      undefined,
    ),
  ).toBeUndefined();
  expect(() =>
    parsePluginWithValue(
      definePlugin({
        async run(context) {
          void context;
        },
      }),
      'local/review',
      {
        reviewer: 'max',
      },
    ),
  ).toThrow(
    'Did not expect with because plugin "local/review" does not declare a with schema.',
  );
  expect(() =>
    parsePluginWithValue(
      definePlugin({
        async run(context) {
          void context;
        },
        with: z.object({
          reviewer: z.string().min(2),
        }),
      }),
      'local/review',
      {
        reviewer: 'x',
      },
    ),
  ).toThrow('reviewer: Too small: expected string to have >=2 characters');
});
