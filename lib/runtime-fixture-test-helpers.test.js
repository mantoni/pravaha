import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { execGitFile } from './shared/git/exec-git-file.js';
import { createFixtureRepo } from './runtime-fixture-test-helpers.js';

it('initializes fixture repositories on the main branch', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const { stdout } = await execGitFile(['branch', '--show-current'], {
      cwd: temp_directory,
      encoding: 'utf8',
    });

    expect(stdout.trim()).toBe('main');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
