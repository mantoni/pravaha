import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { execGitFile } from '../../lib/shared/git/exec-git-file.js';
import {
  createFixtureRepo,
  createFixtureRepoFromFiles,
} from './runtime-fixture.js';

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

it('writes pravaha config overrides into fixture repositories', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-runtime-override-',
    {},
    {
      pravaha_config_override: {
        flows: {
          default_matches: ['docs/flows/**/*.js'],
        },
      },
    },
  );

  try {
    await expect(
      readFile(join(temp_directory, 'pravaha.json'), 'utf8'),
    ).resolves.toContain('"default_matches"');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
