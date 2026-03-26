import process from 'node:process';

import { expect, it } from 'vitest';

import { REPO_DIRECTORY } from './plugin.fixture-test-helpers.js';
import { execGitFile } from './git-process.js';

it('runs git without inheriting hook-scoped git environment variables', async () => {
  await expect(
    execGitFile(['rev-parse', '--show-toplevel'], {
      cwd: REPO_DIRECTORY,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_DIR: '/definitely/not/this/repo',
      },
    }),
  ).resolves.toMatchObject({
    stdout: `${REPO_DIRECTORY}\n`,
  });
});

it('runs git with the process environment when explicit env is omitted', async () => {
  await expect(
    execGitFile(['--version'], {
      encoding: 'utf8',
    }),
  ).resolves.toMatchObject({
    stdout: expect.stringContaining('git version'),
  });
});
