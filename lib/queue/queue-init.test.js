/* eslint-disable max-lines-per-function */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { execGitFile } from '../shared/git/exec-git-file.js';
import { initQueue } from './queue-init.js';
import {
  appendBranchCommit,
  createBranchCommit,
  createQueueFixtureRepo,
  pushQueueRef,
  readGitConfig,
  readHook,
  readQueueRevision,
  readRevision,
} from './queue.test-support.js';

it('initializes the queue repository, installs node hooks, and seeds queue refs', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await writeFile(join(repo_directory, 'seed.txt'), 'seeded queue base\n');
    await execGitFile(['add', 'seed.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Seed queue base'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    const main_head = await readRevision(repo_directory, 'refs/heads/main');
    const init_result = await initQueue(repo_directory);

    expect(init_result).toMatchObject({
      base_source: 'local-target-branch',
      base_ref: 'refs/queue/meta/base',
      candidate_ref: 'refs/queue/candidate/current',
      outcome: 'success',
      target_ref: 'refs/heads/main',
    });
    await expect(
      readQueueRevision(repo_directory, 'refs/queue/meta/base'),
    ).resolves.toBe(main_head);
    await expect(
      readQueueRevision(repo_directory, 'refs/queue/candidate/current'),
    ).resolves.toBe(main_head);
    await expect(
      readQueueRevision(repo_directory, 'refs/heads/main'),
    ).resolves.toBe(main_head);
    await expect(readHook(repo_directory, 'pre-receive')).resolves.toContain(
      '#!/usr/bin/env node',
    );
    await expect(readHook(repo_directory, 'update')).resolves.toContain(
      '#!/usr/bin/env node',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('seeds queue refs from the configured upstream branch without changing local git defaults', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-init-remote-'),
  );

  try {
    await execGitFile(
      ['init', '--bare', '--initial-branch=main', remote_directory],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );
    await execGitFile(['remote', 'add', 'origin', remote_directory], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['push', '--set-upstream', 'origin', 'main'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await writeFile(join(repo_directory, 'local-only.txt'), 'local only\n');
    await execGitFile(['add', 'local-only.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Create local-only commit'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    const branch_remote_before = await readGitConfig(
      repo_directory,
      'branch.main.remote',
    );
    const branch_merge_before = await readGitConfig(
      repo_directory,
      'branch.main.merge',
    );
    const remote_url_before = await readGitConfig(
      repo_directory,
      'remote.origin.url',
    );
    const remote_main_head = await readRevision(
      remote_directory,
      'refs/heads/main',
    );
    const local_main_head = await readRevision(
      repo_directory,
      'refs/heads/main',
    );

    expect(local_main_head).not.toBe(remote_main_head);

    await expect(initQueue(repo_directory)).resolves.toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });

    await expect(
      readQueueRevision(repo_directory, 'refs/queue/meta/base'),
    ).resolves.toBe(remote_main_head);
    await expect(
      readQueueRevision(repo_directory, 'refs/queue/candidate/current'),
    ).resolves.toBe(remote_main_head);
    await expect(
      readQueueRevision(repo_directory, 'refs/heads/main'),
    ).resolves.toBe(remote_main_head);
    await expect(
      readGitConfig(repo_directory, 'branch.main.remote'),
    ).resolves.toBe(branch_remote_before);
    await expect(
      readGitConfig(repo_directory, 'branch.main.merge'),
    ).resolves.toBe(branch_merge_before);
    await expect(
      readGitConfig(repo_directory, 'remote.origin.url'),
    ).resolves.toBe(remote_url_before);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('allows creating ready refs through queue-repo pushes', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await initQueue(repo_directory);
    await createBranchCommit(repo_directory, 'review/push-ready', 'push.txt', [
      'push ready entry',
    ]);

    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/push-ready',
        'refs/queue/ready/0001-review-push-ready',
      ),
    ).resolves.toContain('refs/queue/ready/0001-review-push-ready');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects direct mutation of managed queue refs through queue-repo pushes', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await initQueue(repo_directory);
    await createBranchCommit(
      repo_directory,
      'review/push-internal',
      'internal.txt',
      ['internal ref mutation'],
    );

    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/push-internal',
        'refs/queue/meta/base',
      ),
    ).rejects.toThrow('Direct mutation of managed queue refs is not allowed');
    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/push-internal',
        'refs/queue/candidate/current',
      ),
    ).rejects.toThrow('Direct mutation of managed queue refs is not allowed');
    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/push-internal',
        'refs/heads/main',
      ),
    ).rejects.toThrow('Direct mutation of managed queue refs is not allowed');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects rewriting an existing ready ref through queue-repo pushes', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await initQueue(repo_directory);
    await createBranchCommit(repo_directory, 'review/immutable', 'ready.txt', [
      'first queue value',
    ]);
    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/immutable',
        'refs/queue/ready/0001-review-immutable',
      ),
    ).resolves.toContain('refs/queue/ready/0001-review-immutable');
    await appendBranchCommit(repo_directory, 'review/immutable', 'ready.txt', [
      'second queue value',
    ]);

    await expect(
      pushQueueRef(
        repo_directory,
        'refs/heads/review/immutable',
        'refs/queue/ready/0001-review-immutable',
        true,
      ),
    ).rejects.toThrow('Queue ready refs are immutable');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});
