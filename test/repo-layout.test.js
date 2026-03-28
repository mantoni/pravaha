import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);
/** @type {string[]} */
const REMOVED_FACADES = [
  'lib/pravaha-cli.js',
  'lib/load-flow-definition.js',
  'lib/reconcile-flow.js',
  'lib/validate-flow-document.js',
  'lib/validate-repo.js',
  'lib/create-semantic-model.js',
  'lib/reconcile-semantics.js',
  'lib/validate-semantic-mapping.js',
  'lib/git-process.js',
  'lib/validation-helpers.js',
  'lib/patram-types.ts',
  'lib/validation.types.ts',
  'lib/runtime-attempt.js',
  'lib/local-dispatch-runtime.js',
  'lib/local-dispatch-protocol.js',
];

it('keeps repo-level tests out of lib', async () => {
  const lib_entries = await readdir(new URL('../lib/', import.meta.url));

  expect(lib_entries).not.toContain('github-actions-config.test.js');
  expect(lib_entries).not.toContain('husky-config.test.js');
  expect(lib_entries).not.toContain('release-config.test.js');
});

it('keeps the migrated subsystem directories in lib', async () => {
  const lib_entries = await readdir(join(repo_directory, 'lib'));
  const runtime_entries = await readdir(join(repo_directory, 'lib/runtime'));

  expect(lib_entries).toEqual(
    expect.arrayContaining(['cli', 'flow', 'repo', 'runtime', 'shared']),
  );
  expect(runtime_entries).toEqual(
    expect.arrayContaining(['attempts', 'dispatch']),
  );
});

it('removes root compatibility facades for migrated modules', async () => {
  for (const file_path of REMOVED_FACADES) {
    await expect(
      readFile(join(repo_directory, file_path), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
});
