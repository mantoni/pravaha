import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repo_directory = dirname(
  fileURLToPath(new URL('./package.json', import.meta.url)),
);
/** @type {string[]} */
const REMOVED_FACADES = [
  'lib/define-plugin.js',
  'lib/flow-query.js',
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
/** @type {string[]} */
const MOVED_TESTS = [
  'lib/create-semantic-model.test.js',
  'lib/define-plugin.test.js',
  'lib/flow-query.test.js',
  'lib/git-process.test.js',
  'lib/load-flow-definition.test.js',
  'lib/local-dispatch-protocol.test.js',
  'lib/local-dispatch-runtime.test.js',
  'lib/pravaha-cli.test.js',
  'lib/reconcile-flow.test.js',
  'lib/reconcile-state-machine-flow.test.js',
  'lib/reconcile-semantics.test.js',
  'lib/runtime-attempt.state-machine-coverage.test.js',
  'lib/runtime-attempt.state-machine-edge-cases.test.js',
  'lib/runtime-attempt.state-machine.test.js',
  'lib/validate-flow-document.test.js',
  'lib/validate-repo.test.js',
  'lib/validate-semantic-mapping.test.js',
  'lib/validation-helpers.test.js',
  'test/github-actions-config.test.js',
  'test/husky-config.test.js',
  'test/package-install-smoke.test.js',
  'test/package-metadata.test.js',
  'test/patram-config.test.js',
  'test/patram-queries.test.js',
  'test/pravaha-config.test.js',
  'test/pravaha-validation.test.js',
  'test/release-config.test.js',
  'test/repo-layout.test.js',
  'test/source-metadata-refs.test.js',
  'test/split-dispatch-session-coverage.test.js',
  'test/split-module-coverage.helpers.js',
  'test/split-module-coverage.test.js',
  'test/vitest-tags-config.test.js',
];
/** @type {string[]} */
const REMOVED_TEST_SUPPORT_FILES = [
  'lib/cli/command.test-helpers.js',
  'lib/plugin.fixture-test-helpers.js',
  'lib/reconcile.fixture-test-helpers.js',
  'lib/runtime-attempt.state-machine-test-helpers.js',
  'lib/runtime-fixture-test-helpers.js',
  'lib/runtime-test-helpers.js',
];

it('keeps repo-level tests out of lib', async () => {
  const lib_entries = await readdir(new URL('./lib/', import.meta.url));

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

it('removes the legacy root test buckets after colocating migrated coverage', async () => {
  for (const file_path of MOVED_TESTS) {
    await expect(
      readFile(join(repo_directory, file_path), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
});

it('keeps test support out of the publishable lib tree', async () => {
  for (const file_path of REMOVED_TEST_SUPPORT_FILES) {
    await expect(
      readFile(join(repo_directory, file_path), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
});
