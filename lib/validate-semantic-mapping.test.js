import { expect, it } from 'vitest';

import { validateSemanticMapping } from './validate-semantic-mapping.js';

it('accepts valid semantic mappings', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const actual_result = validateSemanticMapping(
    {
      ready: ['ready'],
      review: ['review'],
    },
    new Set(['ready', 'review']),
    'semantic state',
    'pravaha.json',
    diagnostics,
    ['ready'],
  );

  expect(actual_result).toEqual(new Set(['ready', 'review']));
  expect(diagnostics).toEqual([]);
});

it('reports invalid target arrays, unknown targets, duplicates, and missing required names', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const actual_result = validateSemanticMapping(
    {
      blocked: ['blocked'],
      duplicate_a: ['shared'],
      duplicate_b: ['shared'],
      empty: [],
      invalid: [7],
      unknown: ['missing'],
    },
    new Set(['blocked', 'shared']),
    'semantic state',
    'pravaha.json',
    diagnostics,
    ['ready'],
  );

  expect(actual_result).toBeNull();
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Mapped target "shared" is assigned to both semantic states "duplicate_a" and "duplicate_b".',
    },
    {
      file_path: 'pravaha.json',
      message: 'semantic state "empty" must map to a non-empty string array.',
    },
    {
      file_path: 'pravaha.json',
      message: 'semantic state "invalid" contains an invalid mapped value.',
    },
    {
      file_path: 'pravaha.json',
      message: 'semantic state "unknown" references unknown target "missing".',
    },
    {
      file_path: 'pravaha.json',
      message: 'Missing required semantic state "ready".',
    },
  ]);
});

it('reports duplicate mapped targets and empty mappings', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const duplicate_diagnostics = [];

  expect(
    validateSemanticMapping(
      {
        alpha: ['shared'],
        beta: ['shared'],
      },
      new Set(['shared']),
      'semantic role',
      'pravaha.json',
      duplicate_diagnostics,
    ),
  ).toBeNull();
  expect(duplicate_diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Mapped target "shared" is assigned to both semantic roles "alpha" and "beta".',
    },
  ]);

  /** @type {Array<{ file_path: string, message: string }>} */
  const empty_diagnostics = [];

  expect(
    validateSemanticMapping(
      {},
      new Set(['shared']),
      'semantic role',
      'pravaha.json',
      empty_diagnostics,
    ),
  ).toBeNull();
  expect(empty_diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message: 'Pravaha config must define at least one semantic role.',
    },
  ]);
});
