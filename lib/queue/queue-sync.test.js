/* eslint-disable max-lines, max-lines-per-function */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { execGitFile } from '../shared/git/exec-git-file.js';
import { enqueueQueueHandoff } from './queue-handoff.js';
import { syncQueue } from './queue-sync.js';
import {
  createBranchCommit,
  createQueueFixtureRepo,
  isQueueRevisionAncestor,
  isRevisionAncestor,
  listQueueValidationRuntimeRecords,
  listReadyRefs,
  parseRuntimeRecord,
  readQueueRevision,
  readRevision,
  startQueueRun,
  writeQueueValidationFlow,
} from './queue.test-support.js';

it('rejects queued entries on sync and resumes the waiting run with failure', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/conflict',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await commitSharedBase(repo_directory);

    await createBranchCommit(repo_directory, 'review/conflict', 'shared.txt', [
      'branch',
    ]);

    await commitConflictingMainChange(repo_directory);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    const sync_result = await syncQueue(repo_directory);
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    expect(sync_result.outcome).toBe('failure');
    expect(runtime_record.local_outcome.state).toBe('failure');
    expect(runtime_record.queue_wait?.state).toBe('failed');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('stops sync after the first merge failure and leaves later ready refs pending', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/conflict',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await commitSharedBase(repo_directory);
    await createBranchCommit(
      repo_directory,
      'review/safe-before',
      'before.txt',
      ['safe before'],
    );
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/safe-before',
      run_id: 'run-safe-before',
    });
    await createBranchCommit(repo_directory, 'review/conflict', 'shared.txt', [
      'branch',
    ]);
    await commitConflictingMainChange(repo_directory);
    await createBranchCommit(repo_directory, 'review/safe-after', 'after.txt', [
      'safe after',
    ]);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/safe-after',
      run_id: 'run-safe-after',
    });

    const sync_result = await syncQueue(repo_directory);
    const queue_tip = await readQueueRevision(
      repo_directory,
      'refs/heads/main',
    );
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    await expectPendingReadyRefsAfterFailedSync({
      failed_ready_ref: 'refs/queue/ready/0002-review-conflict',
      queue_tip,
      repo_directory,
      runtime_record,
      sync_result,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails sync when the configured upstream remote cannot be fetched', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/unreachable-sync',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-unreachable-sync-'),
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
      'review/unreachable-sync',
      'sync.txt',
      ['unreachable sync'],
    );

    const initial_result = await startQueueRun(repo_directory);
    const validated_tip_before = await readQueueRevision(
      repo_directory,
      'refs/heads/main',
    );
    const candidate_before = await readQueueRevision(
      repo_directory,
      'refs/queue/candidate/current',
    );
    const runtime_record_before = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    await rm(remote_directory, { force: true, recursive: true });

    await expect(syncQueue(repo_directory)).rejects.toThrow(
      /Failed to fetch upstream base from remote "origin" branch "main"\./,
    );

    const runtime_record_after = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-unreachable-sync'),
    ]);
    await expect(
      readQueueRevision(repo_directory, 'refs/heads/main'),
    ).resolves.toBe(validated_tip_before);
    await expect(
      readQueueRevision(repo_directory, 'refs/queue/candidate/current'),
    ).resolves.toBe(candidate_before);
    expect(runtime_record_before.local_outcome.state).toBe(
      runtime_record_after.local_outcome.state,
    );
    expect(runtime_record_after.queue_wait?.state).toBe('waiting');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('keeps ready refs queued and does not publish upstream on successful sync', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/sync-only',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const remote_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-queue-sync-only-remote-'),
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
    await createBranchCommit(repo_directory, 'review/sync-only', 'sync.txt', [
      'sync only change',
    ]);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    const runtime_record_before = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );
    const remote_main_before = await readRevision(
      remote_directory,
      'refs/heads/main',
    );
    const sync_result = await syncQueue(repo_directory);
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );
    const remote_main_after = await readRevision(
      remote_directory,
      'refs/heads/main',
    );

    expect(sync_result).toMatchObject({
      base_source: 'fetched-upstream',
      outcome: 'success',
      rejected_ready_refs: [],
      resumed_runs: [],
    });
    expect(runtime_record.local_outcome.state).toBe(
      runtime_record_before.local_outcome.state,
    );
    expect(runtime_record.queue_wait?.state).toBe('waiting');
    expect(remote_main_after).toBe(remote_main_before);
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-sync-only'),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
    await rm(remote_directory, { force: true, recursive: true });
  }
});

it('runs the optional validation flow against each queue candidate before advancing the validated tip', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/validated',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await writeQueueValidationFlow(
      repo_directory,
      'test -f validated.txt',
      'success',
    );
    await createBranchCommit(
      repo_directory,
      'review/validated',
      'validated.txt',
      ['validated candidate'],
    );

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    const sync_result = await syncQueue(repo_directory);
    const queue_tip = await readQueueRevision(
      repo_directory,
      'refs/heads/main',
    );
    const candidate_tip = await readQueueRevision(
      repo_directory,
      'refs/queue/candidate/current',
    );
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    expect(sync_result).toMatchObject({
      outcome: 'success',
      rejected_ready_refs: [],
      resumed_runs: [],
    });
    expect(candidate_tip).toBe(queue_tip);
    expect(runtime_record.queue_wait?.state).toBe('waiting');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-validated'),
    ]);
    await expect(
      listQueueValidationRuntimeRecords(repo_directory),
    ).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects only the ready ref whose queue candidate fails the optional validation flow', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/forbidden',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await writeQueueValidationFlow(
      repo_directory,
      'test ! -f forbidden.txt',
      'success',
    );
    await createBranchCommit(repo_directory, 'review/safe', 'safe.txt', [
      'safe queue entry',
    ]);
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/safe',
      run_id: 'run-safe',
    });
    await createBranchCommit(
      repo_directory,
      'review/forbidden',
      'forbidden.txt',
      ['forbidden queue entry'],
    );

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    const sync_result = await syncQueue(repo_directory);
    const queue_tip = await readQueueRevision(
      repo_directory,
      'refs/heads/main',
    );
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );
    const resumed_run = sync_result.resumed_runs[0];

    expect(sync_result).toMatchObject({
      outcome: 'failure',
      rejected_ready_refs: [
        expect.stringContaining('refs/queue/ready/0002-review-forbidden'),
      ],
    });
    expect(sync_result.resumed_runs).toHaveLength(1);
    expect(resumed_run?.outcome).toBe('failure');
    expect(resumed_run?.ready_ref).toContain(
      'refs/queue/ready/0002-review-forbidden',
    );
    expect(runtime_record.local_outcome.state).toBe('failure');
    expect(runtime_record.queue_wait?.state).toBe('failed');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-safe'),
    ]);
    await expect(
      isRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/safe'),
        queue_tip,
      ),
    ).resolves.toBe(true);
    await expect(
      isRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/forbidden'),
        queue_tip,
      ),
    ).resolves.toBe(false);
    await expect(
      listQueueValidationRuntimeRecords(repo_directory),
    ).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('stops sync after the first validation failure and leaves later ready refs pending', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/forbidden',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await writeQueueValidationFlow(
      repo_directory,
      'test ! -f forbidden.txt',
      'success',
    );
    await createBranchCommit(
      repo_directory,
      'review/safe-before',
      'before.txt',
      ['safe queue entry'],
    );
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/safe-before',
      run_id: 'run-safe-before',
    });
    await createBranchCommit(
      repo_directory,
      'review/forbidden',
      'forbidden.txt',
      ['forbidden queue entry'],
    );
    await createBranchCommit(repo_directory, 'review/safe-after', 'after.txt', [
      'safe after queue entry',
    ]);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/safe-after',
      run_id: 'run-safe-after',
    });

    const sync_result = await syncQueue(repo_directory);
    const queue_tip = await readQueueRevision(
      repo_directory,
      'refs/heads/main',
    );
    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    await expectPendingReadyRefsAfterFailedSync({
      failed_ready_ref: 'refs/queue/ready/0002-review-forbidden',
      queue_tip,
      repo_directory,
      runtime_record,
      sync_result,
    });
    await expect(
      listQueueValidationRuntimeRecords(repo_directory),
    ).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('syncs an empty queue by advancing the candidate ref to the current base', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await expect(syncQueue(repo_directory)).resolves.toEqual({
      base_source: 'local-target-branch',
      outcome: 'success',
      rejected_ready_refs: [],
      resumed_runs: [],
    });
    const base_head = await readQueueRevision(
      repo_directory,
      'refs/queue/meta/base',
    );

    await expect(
      readQueueRevision(repo_directory, 'refs/queue/candidate/current'),
    ).resolves.toBe(base_head);
    await expect(
      readQueueRevision(repo_directory, 'refs/heads/main'),
    ).resolves.toBe(base_head);
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function commitSharedBase(repo_directory) {
  await writeFile(join(repo_directory, 'shared.txt'), 'base\n', 'utf8');
  await execGitFile(['add', 'shared.txt'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', 'Add shared base'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function commitConflictingMainChange(repo_directory) {
  await writeFile(join(repo_directory, 'shared.txt'), 'main\n', 'utf8');
  await execGitFile(['add', 'shared.txt'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', 'Conflicting main change'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {{
 *   failed_ready_ref: string,
 *   queue_tip: string,
 *   repo_directory: string,
 *   runtime_record: {
 *     local_outcome: { state: string },
 *     queue_wait?: { state: string },
 *   },
 *   sync_result: Awaited<ReturnType<typeof syncQueue>>,
 * }} options
 * @returns {Promise<void>}
 */
async function expectPendingReadyRefsAfterFailedSync(options) {
  expect(options.sync_result).toMatchObject({
    outcome: 'failure',
    rejected_ready_refs: [expect.stringContaining(options.failed_ready_ref)],
    resumed_runs: [{ outcome: 'failure' }],
  });
  expect(options.sync_result.resumed_runs).toHaveLength(1);
  expect(options.sync_result.resumed_runs[0]?.ready_ref).toContain(
    options.failed_ready_ref,
  );
  expect(options.runtime_record.local_outcome.state).toBe('failure');
  expect(options.runtime_record.queue_wait?.state).toBe('failed');
  await expect(listReadyRefs(options.repo_directory)).resolves.toEqual([
    expect.stringContaining('refs/queue/ready/0001-review-safe-before'),
    expect.stringContaining('refs/queue/ready/0003-review-safe-after'),
  ]);
  await expect(
    isQueueRevisionAncestor(
      options.repo_directory,
      await readRevision(
        options.repo_directory,
        'refs/heads/review/safe-before',
      ),
      options.queue_tip,
    ),
  ).resolves.toBe(true);
  await expect(
    isQueueRevisionAncestor(
      options.repo_directory,
      await readRevision(
        options.repo_directory,
        'refs/heads/review/safe-after',
      ),
      options.queue_tip,
    ),
  ).resolves.toBe(false);
}
