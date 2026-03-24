import { readdir } from 'node:fs/promises';

import { expect, it } from 'vitest';

it('keeps repo-level tests out of lib', async () => {
  const lib_entries = await readdir(new URL('../lib/', import.meta.url));

  expect(lib_entries).not.toContain('github-actions-config.test.js');
  expect(lib_entries).not.toContain('husky-config.test.js');
  expect(lib_entries).not.toContain('release-config.test.js');
});
