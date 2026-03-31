import { expect, it } from 'vitest';

import { assertValidConfig, defineConfig } from './config-contract.js';

it('brands config definitions created with defineConfig', () => {
  const config_definition = defineConfig({
    flows: ['flows/implement-task.js'],
    workspaces: {
      app: {
        mode: 'pooled',
        paths: ['.pravaha/worktrees/app'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
  });

  expect(assertValidConfig(config_definition, 'pravaha.config.js')).toBe(
    config_definition,
  );
});

it('rejects invalid config definition inputs and unbranded exports', () => {
  expect(() =>
    defineConfig(/** @type {never} */ (/** @type {unknown} */ (null))),
  ).toThrow('Pravaha config must be an object.');
  expect(() =>
    assertValidConfig(
      {
        flows: ['flows/implement-task.js'],
      },
      'pravaha.config.js',
    ),
  ).toThrow(
    'Pravaha config module "pravaha.config.js" must default-export defineConfig(...).',
  );
});
