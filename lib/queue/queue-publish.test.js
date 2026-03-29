/* eslint-disable max-lines-per-function */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { execGitFile } from '../shared/git/exec-git-file.js';
import { enqueueQueueHandoff } from './queue-handoff.js';
import { publishQueue } from './queue-publish.js';
import { syncQueue } from './queue-sync.js';
import {
  createBranchCommit,
  createQueueFixtureRepo,
  listReadyRefs,
  parseRuntimeRecord,
  readRevision,
  startQueueRun,
} from './queue.test-support.js';

it('prunes adopted ready refs on publish and resumes the waiting run with success', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/publish',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-remote-'),
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
    await createBranchCommit(repo_directory, 'review/publish', 'publish.txt', [
      'publish change',
    ]);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });
    const publish_result = await publishQueue(repo_directory);

    expect(publish_result).toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });

    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );
    const remote_main_head = await readRevision(
      remote_directory,
      'refs/heads/main',
    );

    expect(runtime_record.local_outcome.state).toBe('success');
    expect(runtime_record.queue_wait?.state).toBe('succeeded');
    expect(remote_main_head).toBe(publish_result.published_head);
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('fails publish without pruning ready refs when the upstream remote is unreachable', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/unreachable-publish',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-unreachable-publish-'),
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
    await createBranchCommit(
      repo_directory,
      'review/unreachable-publish',
      'publish.txt',
      ['unreachable publish'],
    );

    const initial_result = await startQueueRun(repo_directory);

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });

    await rm(remote_directory, { force: true, recursive: true });

    await expect(publishQueue(repo_directory)).rejects.toThrow();

    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining(
        'refs/queue/ready/0001-review-unreachable-publish',
      ),
    ]);
    expect(runtime_record.queue_wait?.state).toBe('waiting');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('fails publish with an explicit message when queue base source metadata is missing', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/missing-base-source',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-missing-base-source-'),
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
    await createBranchCommit(
      repo_directory,
      'review/missing-base-source',
      'publish.txt',
      ['missing base source'],
    );

    await startQueueRun(repo_directory);
    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });
    await execGitFile(
      [
        '--git-dir',
        `${repo_directory}/.pravaha/queue.git`,
        'config',
        '--local',
        '--unset-all',
        'pravaha.queueBaseSource',
      ],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    await expect(publishQueue(repo_directory)).rejects.toThrow(
      'Expected queue base source metadata. Run "pravaha queue sync" before publishing.',
    );
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining(
        'refs/queue/ready/0001-review-missing-base-source',
      ),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('fails publish with an explicit message when queue base source metadata is invalid', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/invalid-base-source',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-invalid-base-source-'),
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
    await createBranchCommit(
      repo_directory,
      'review/invalid-base-source',
      'publish.txt',
      ['invalid base source'],
    );

    await startQueueRun(repo_directory);
    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
    });
    await execGitFile(
      [
        '--git-dir',
        `${repo_directory}/.pravaha/queue.git`,
        'config',
        '--local',
        'pravaha.queueBaseSource',
        'invalid-source',
      ],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    await expect(publishQueue(repo_directory)).rejects.toThrow(
      'Expected queue base source metadata. Run "pravaha queue sync" before publishing.',
    );
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining(
        'refs/queue/ready/0001-review-invalid-base-source',
      ),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('prunes only ready refs that were adopted by the published upstream branch', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-publish-partial-'),
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
    await createBranchCommit(
      repo_directory,
      'review/first-publish',
      'first.txt',
      ['first queue entry'],
    );
    await createBranchCommit(
      repo_directory,
      'review/second-publish',
      'second.txt',
      ['second queue entry'],
    );
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/first-publish',
      run_id: 'run-1',
    });

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });

    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/second-publish',
      run_id: 'run-2',
    });

    await expect(publishQueue(repo_directory)).resolves.toMatchObject({
      adopted_ready_refs: [
        expect.stringContaining('refs/queue/ready/0001-review-first-publish'),
      ],
    });
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0002-review-second-publish'),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});
