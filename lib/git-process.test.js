import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import { REPO_DIRECTORY } from './plugin.fixture-test-helpers.js';
import { execGitFile } from './shared/git/exec-git-file.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

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

it('removes hook-scoped git variables from explicit child environments', async () => {
  /** @type {NodeJS.ProcessEnv | null} */
  let received_env = null;

  vi.doMock('node:child_process', () => ({
    /**
     * @param {string} file
     * @param {readonly string[]} arguments_
     * @param {unknown} options
     * @param {(error: Error | null, stdout: string, stderr: string) => void} callback
     */
    execFile(file, arguments_, options, callback) {
      void file;
      void arguments_;
      received_env =
        /** @type {{ env?: NodeJS.ProcessEnv }} */ (options).env ?? null;
      callback(null, '', '');
    },
  }));

  const { execGitFile: mockedExecGitFile } =
    await import('./shared/git/exec-git-file.js');

  await mockedExecGitFile(['status'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_COMMON_DIR: '/tmp/common',
      GIT_DIR: '/tmp/repo',
      GIT_WORK_TREE: '/tmp/worktree',
      KEEP_ME: 'yes',
    },
  });

  expect(received_env).not.toBeNull();

  if (received_env === null) {
    throw new Error('Expected the mocked git environment to be captured.');
  }

  const child_env = /** @type {NodeJS.ProcessEnv} */ (
    /** @type {unknown} */ (received_env)
  );

  expect(child_env.GIT_COMMON_DIR).toBeUndefined();
  expect(child_env.GIT_DIR).toBeUndefined();
  expect(child_env.GIT_WORK_TREE).toBeUndefined();
  expect(child_env.KEEP_ME).toBe('yes');
});
