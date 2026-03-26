import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createFixtureRepo,
  createFixtureRepoFromFiles,
} from './run-happy-path.fixture-test-helpers.js';
import { validateRepo } from './validate-repo.js';

it('validates a fixture repo and reports the checked flow count', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces flow-directory diagnostics when no checked-in flows exist', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {},
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 0,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows`,
          message: expect.stringContaining('Cannot read flow directory:'),
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
