import { afterEach, expect, it, vi } from 'vitest';

const { execGitFileMock, loadPravahaConfigMock } = vi.hoisted(() => ({
  execGitFileMock: vi.fn(),
  loadPravahaConfigMock: vi.fn(),
}));

vi.mock(import('../config/load-pravaha-config.js'), () => ({
  loadPravahaConfig: loadPravahaConfigMock,
}));

vi.mock(import('../shared/git/exec-git-file.js'), () => ({
  execGitFile: execGitFileMock,
}));

afterEach(() => {
  vi.resetModules();
  execGitFileMock.mockReset();
  loadPravahaConfigMock.mockReset();
});

it('reports Error upstream remote inspection failures when git stderr is empty', async () => {
  vi.resetModules();

  loadPravahaConfigMock.mockResolvedValue({
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
  execGitFileMock.mockImplementation(rejectOnRemoteGetUrl);

  const queue_module = await import('./queue.js');

  await expect(queue_module.initQueue('/repo')).rejects.toThrow(
    'Failed to inspect upstream remote "origin". remote inspection failed',
  );
});

it('falls back to the local target branch when git reports a missing upstream remote in a localized message', async () => {
  vi.resetModules();

  execGitFileMock.mockImplementation(rejectWithMissingRemoteMessage);

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

/**
 * @param {string[]} command_arguments
 * @returns {Promise<{ stderr: string, stdout: string }>}
 */
function rejectOnRemoteGetUrl(command_arguments) {
  if (command_arguments[0] === 'remote' && command_arguments[1] === 'get-url') {
    return Promise.reject(new Error('remote inspection failed'));
  }

  throw new Error(`Unexpected git call ${JSON.stringify(command_arguments)}.`);
}

/**
 * @param {string[]} command_arguments
 * @returns {Promise<{ stderr: string, stdout: string }>}
 */
function rejectWithMissingRemoteMessage(command_arguments) {
  if (command_arguments[0] === 'remote' && command_arguments[1] === 'get-url') {
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

  throw new Error(`Unexpected git call ${JSON.stringify(command_arguments)}.`);
}
