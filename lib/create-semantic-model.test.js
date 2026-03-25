import { expect, it } from 'vitest';

import { createSemanticModel } from './create-semantic-model.js';

it('builds a semantic model from valid Patram and Pravaha config results', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const semantic_model = createSemanticModel(
    {
      value: {
        classes: {
          contract: {},
          task: {},
        },
        fields: {
          status: {
            values: ['ready', 'review'],
          },
        },
      },
      diagnostics: [],
    },
    {
      value: {
        semantic_roles: {
          contract: ['contract'],
          task: ['task'],
        },
        semantic_states: {
          ready: ['ready'],
          review: ['review'],
        },
      },
      diagnostics: [],
    },
    'pravaha.json',
    diagnostics,
  );

  expect(semantic_model).toEqual({
    semantic_role_names: new Set(['contract', 'task']),
    semantic_state_names: new Set(['ready', 'review']),
  });
  expect(diagnostics).toEqual([]);
});

it('reports Patram shape errors and invalid Pravaha mapping objects', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const semantic_model = createSemanticModel(
    {
      value: {
        classes: {},
        fields: {},
      },
      diagnostics: [],
    },
    {
      value: {
        semantic_roles: [],
        semantic_states: {},
      },
      diagnostics: [],
    },
    'pravaha.json',
    diagnostics,
  );

  expect(semantic_model).toBeNull();
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message: 'Cannot validate semantic states without a Patram status enum.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Cannot validate semantic mappings without Patram classes and fields.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config must define object-valued semantic_roles and semantic_states mappings.',
    },
  ]);
});

it('returns null when either config result has no object payload', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const semantic_model = createSemanticModel(
    {
      value: null,
      diagnostics: [{ file_path: '.patram.json', message: 'bad patram' }],
    },
    {
      value: null,
      diagnostics: [{ file_path: 'pravaha.json', message: 'bad pravaha' }],
    },
    'pravaha.json',
    diagnostics,
  );

  expect(semantic_model).toBeNull();
  expect(diagnostics).toEqual([
    {
      file_path: '.patram.json',
      message: 'bad patram',
    },
    {
      file_path: 'pravaha.json',
      message: 'bad pravaha',
    },
  ]);
});
