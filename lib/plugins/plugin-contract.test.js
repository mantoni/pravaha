import { expect, it } from 'vitest';

import { assertValidPlugin, definePlugin } from './plugin-contract.js';

it('defines and validates branded plugins', () => {
  const plugin_definition = definePlugin({
    run(context) {
      void context;
      return Promise.resolve();
    },
  });

  expect(Object.isFrozen(plugin_definition)).toBe(true);
  expect(assertValidPlugin(plugin_definition, 'local/review')).toBe(
    plugin_definition,
  );
});

it('rejects invalid plugin definitions', () => {
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
        run(context) {
          void context;

          return Promise.resolve();
        },
        with: /** @type {never} */ ({ parse: true }),
      }),
      'local/review',
    ),
  ).toThrow('must declare with as a Zod schema when present');
});
