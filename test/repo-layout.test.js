import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
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
const REMOVED_LEGACY_TEST_BUCKETS = [
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
  'test/pravaha-validation.test.js',
  'test/split-dispatch-session-coverage.test.js',
  'test/split-module-coverage.helpers.js',
  'test/split-module-coverage.test.js',
];
/** @type {string[]} */
const ROOT_LEVEL_TEST_FILES = [
  'github-actions-config.test.js',
  'husky-config.test.js',
  'knip-config.test.js',
  'package-install-smoke.test.js',
  'package-metadata.test.js',
  'patram-config.test.js',
  'patram-queries.test.js',
  'pravaha-config.test.js',
  'release-config.test.js',
  'repo-layout.test.js',
  'source-metadata-refs.test.js',
  'vitest-tags-config.test.js',
];
/** @type {string[]} */
const REPO_TEST_FILES = [
  'github-actions-config.test.js',
  'husky-config.test.js',
  'knip-config.test.js',
  'package-install-smoke.test.js',
  'package-metadata.test.js',
  'patram-config.test.js',
  'patram-queries.test.js',
  'pravaha-config.test.js',
  'release-config.test.js',
  'repo-layout.test.js',
  'source-metadata-refs.test.js',
  'vitest-tags-config.test.js',
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
  const lib_entries = await readdir(new URL('../lib/', import.meta.url));

  expect(lib_entries).not.toContain('github-actions-config.test.js');
  expect(lib_entries).not.toContain('husky-config.test.js');
  expect(lib_entries).not.toContain('release-config.test.js');
});

it('keeps repo-level tests under test', async () => {
  const test_entries = await readdir(join(repo_directory, 'test'));

  expect(test_entries).toEqual(expect.arrayContaining(REPO_TEST_FILES));
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
  for (const file_path of REMOVED_LEGACY_TEST_BUCKETS) {
    await expect(
      readFile(join(repo_directory, file_path), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
});

it('removes repo-level test files from the package root', async () => {
  for (const file_path of ROOT_LEVEL_TEST_FILES) {
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
