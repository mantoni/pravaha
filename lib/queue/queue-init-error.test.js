import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../config/load-pravaha-config.js');
  vi.doUnmock('../shared/git/exec-git-file.js');
});

it('reports Error upstream remote inspection failures when git stderr is empty', async () => {
  vi.resetModules();

  vi.doMock('../config/load-pravaha-config.js', () => ({
    loadPravahaConfig() {
      return Promise.resolve({
        config: {
          queue_config: {
            base_ref: 'refs/queue/meta/base',
            candidate_ref: 'refs/queue/candidate/current',
            dir: '.pravaha/queue.git',
            ready_ref_prefix: 'refs/queue/ready',
            target_branch: 'main',
            upstream_remote: 'origin',
            validation_flow: null,
          },
        },
        diagnostics: [],
      });
    },
  }));
  vi.doMock('../shared/git/exec-git-file.js', () => ({
    /**
     * @param {string[]} command_arguments
     * @returns {Promise<{ stderr: string, stdout: string }>}
     */
    execGitFile(command_arguments) {
      if (
        command_arguments[0] === 'remote' &&
        command_arguments[1] === 'get-url'
      ) {
        return Promise.reject(new Error('remote inspection failed'));
      }

      throw new Error(
        `Unexpected git call ${JSON.stringify(command_arguments)}.`,
      );
    },
  }));

  const queue_module = await import('./queue.js');

  await expect(queue_module.initQueue('/repo')).rejects.toThrow(
    'Failed to inspect upstream remote "origin". remote inspection failed',
  );
});

it('falls back to the local target branch when git reports a missing upstream remote in a localized message', async () => {
  vi.resetModules();

  vi.doMock('../shared/git/exec-git-file.js', () => ({
    /**
     * @param {string[]} command_arguments
     * @returns {Promise<{ stderr: string, stdout: string }>}
     */
    execGitFile(command_arguments) {
      if (
        command_arguments[0] === 'remote' &&
        command_arguments[1] === 'get-url'
      ) {
        const error = new Error(
          "Command failed: git remote get-url origin\nFehler: Remote-Repository 'origin' nicht gefunden\n",
        );

        return Promise.reject(
          Object.assign(error, {
            code: 2,
            stderr: "Fehler: Remote-Repository 'origin' nicht gefunden\n",
          }),
        );
      }

      if (command_arguments[0] === 'rev-parse') {
        return Promise.resolve({ stderr: '', stdout: 'deadbeef\n' });
      }

      throw new Error(
        `Unexpected git call ${JSON.stringify(command_arguments)}.`,
      );
    },
  }));

  const queue_shared_module = await import('./queue-shared.js');

  await expect(
    queue_shared_module.resolveQueueBaseSource('/repo', {
      target_branch: 'main',
      upstream_remote: 'origin',
    }),
  ).resolves.toEqual({
    base_source: 'local-target-branch',
    source_ref: 'refs/heads/main',
  });
});
