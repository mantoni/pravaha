import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import vitest_config from '../vitest.config.js';

it('defines tag-aware Vitest timeout profiles and a higher slow-test threshold', () => {
  const test_config = vitest_config.test;

  if (!test_config) {
    throw new Error('Expected vitest.config.js to define a test config.');
  }

  expect(test_config.slowTestThreshold).toBe(5_000);
  expect(test_config.tags).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'integration',
        timeout: 15_000,
      }),
      expect.objectContaining({
        name: 'smoke',
        timeout: 30_000,
      }),
    ]),
  );
});

it('marks tagged integration and smoke tests in the expected files', async () => {
  const update_changelog_test = await readFile(
    new URL('../scripts/update-changelog.test.js', import.meta.url),
    'utf8',
  );
  const smoke_test_text = await readFile(
    new URL('../test/package-install-smoke.test.js', import.meta.url),
    'utf8',
  );
  const package_metadata_test_text = await readFile(
    new URL('../test/package-metadata.test.js', import.meta.url),
    'utf8',
  );

  expect(update_changelog_test).toContain('@module-tag integration');
  expect(smoke_test_text).toContain('@module-tag smoke');
  expect(package_metadata_test_text).toContain("tags: ['integration']");
});
