import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  compareText,
  createDiagnostic,
  getErrorMessage,
  isPlainObject,
  listMarkdownFiles,
  readJsonFile,
} from './validation-helpers.js';

it('lists markdown files recursively and sorts them', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-helpers-'));
  const nested_directory = join(temp_directory, 'nested');

  try {
    await mkdir(nested_directory, { recursive: true });
    await writeFile(join(temp_directory, 'b.md'), '# b\n');
    await writeFile(join(temp_directory, 'a.txt'), 'a\n');
    await writeFile(join(nested_directory, 'a.md'), '# a\n');

    /** @type {Array<{ file_path: string, message: string }>} */
    const diagnostics = [];

    await expect(
      listMarkdownFiles(temp_directory, diagnostics),
    ).resolves.toEqual([
      join(temp_directory, 'b.md'),
      join(nested_directory, 'a.md'),
    ]);
    expect(diagnostics).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports missing directories and JSON parse failures', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-helpers-'));
  const json_path = join(temp_directory, 'broken.json');

  try {
    await writeFile(json_path, '{broken');

    /** @type {Array<{ file_path: string, message: string }>} */
    const diagnostics = [];

    await expect(
      listMarkdownFiles(join(temp_directory, 'missing'), diagnostics),
    ).resolves.toEqual([]);
    await expect(readJsonFile(json_path)).resolves.toEqual({
      value: null,
      diagnostics: [
        {
          file_path: json_path,
          message: expect.stringContaining('Cannot load JSON file:'),
        },
      ],
    });
    expect(diagnostics).toEqual([
      {
        file_path: join(temp_directory, 'missing'),
        message: expect.stringContaining('Cannot read flow directory:'),
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('exposes the small helper utilities', () => {
  expect(compareText('a', 'b')).toBeLessThan(0);
  expect(compareText('same', 'same')).toBe(0);
  expect(createDiagnostic('flow.md', 'bad')).toEqual({
    file_path: 'flow.md',
    message: 'bad',
  });
  expect(getErrorMessage(new Error('broken'))).toBe('broken');
  expect(getErrorMessage('plain text')).toBe('plain text');
  expect(getErrorMessage(7)).toBe('7');
  expect(isPlainObject({ ok: true })).toBe(true);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject(null)).toBe(false);
});

it('reads valid json files', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-helpers-'));
  const json_path = join(temp_directory, 'valid.json');

  try {
    await writeFile(json_path, '{"ok":true}\n');

    await expect(readJsonFile(json_path)).resolves.toEqual({
      value: {
        ok: true,
      },
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
