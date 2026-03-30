import { expect, it } from 'vitest';

import { createPatramModel } from './create-patram-model.js';

it('creates a Patram model from classes and status values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const patram_model = createPatramModel(
    {
      diagnostics: [
        {
          file_path: '.patram.json',
          message: 'json warning',
        },
      ],
      value: {
        classes: {
          $runtime: {},
          contract: {},
          document: {
            builtin: true,
          },
          task: {},
        },
        fields: {
          status: {
            values: ['ready', 'done'],
          },
        },
      },
    },
    '.patram.json',
    diagnostics,
  );

  expect(patram_model).toEqual({
    class_names: new Set(['contract', 'task']),
    status_names: new Set(['ready', 'done']),
  });
  expect(diagnostics).toEqual([
    {
      file_path: '.patram.json',
      message: 'json warning',
    },
  ]);
});

it('returns null when the Patram config is not an object', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const patram_model = createPatramModel(
    {
      diagnostics: [],
      value: null,
    },
    '.patram.json',
    diagnostics,
  );

  expect(patram_model).toBeNull();
  expect(diagnostics).toEqual([]);
});

it('reports missing Patram classes', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  const patram_model = createPatramModel(
    {
      diagnostics: [],
      value: {
        fields: {
          status: {
            values: ['ready'],
          },
        },
      },
    },
    '.patram.json',
    diagnostics,
  );

  expect(patram_model).toBeNull();
  expect(diagnostics).toEqual([
    {
      file_path: '.patram.json',
      message: 'Cannot validate flow triggers without Patram classes.',
    },
  ]);
});

it('reports a missing Patram status enum', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const missing_status_diagnostics = [];

  expect(
    createPatramModel(
      {
        diagnostics: [],
        value: {
          classes: {
            task: {},
          },
          fields: {},
        },
      },
      '.patram.json',
      missing_status_diagnostics,
    ),
  ).toBeNull();
  expect(missing_status_diagnostics).toEqual([
    {
      file_path: '.patram.json',
      message: 'Cannot validate flow triggers without a Patram status enum.',
    },
  ]);
});

it('reports invalid Patram status values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    createPatramModel(
      {
        diagnostics: [],
        value: {
          classes: {
            task: {},
          },
          fields: {
            status: {
              values: 'ready',
            },
          },
        },
      },
      '.patram.json',
      diagnostics,
    ),
  ).toBeNull();
  expect(diagnostics).toEqual([
    {
      file_path: '.patram.json',
      message: 'Cannot validate flow triggers without a Patram status enum.',
    },
  ]);
});
