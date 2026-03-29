import { readFile, rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { enqueueQueueHandoff } from './queue-handoff.js';
import { pullQueue } from './queue-pull.js';
import { syncQueue } from './queue-sync.js';
import {
  createBranchCommit,
  createQueueFixtureRepo,
  listReadyRefs,
  parseRuntimeRecord,
  startQueueRun,
} from './queue.test-support.js';

it('prunes adopted ready refs on pull and resumes the waiting run with success', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: [
      '  queue_review:',
      '    uses: core/queue-handoff',
      '    with:',
      '      branch: review/success',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });

  try {
    await createBranchCommit(repo_directory, 'review/success', 'review.txt', [
      'queued change',
    ]);

    const initial_result = await startQueueRun(repo_directory);

    expect(initial_result.outcome).toBe('pending-queue');

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });
    await expect(pullQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });

    const runtime_record = parseRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    expect(runtime_record.local_outcome.state).toBe('success');
    expect(runtime_record.queue_wait?.state).toBe('succeeded');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('adopts queued refs even when no waiting runtime record matches the queue entry', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await createBranchCommit(repo_directory, 'review/orphan', 'orphan.txt', [
      'orphan queue entry',
    ]);
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/orphan',
      run_id: 'run-1',
    });

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });
    await expect(pullQueue(repo_directory)).resolves.toMatchObject({
      adopted_ready_refs: [
        expect.stringContaining('refs/queue/ready/0001-review-orphan'),
      ],
      resumed_runs: [],
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('prunes only ready refs that were adopted by the current candidate tip', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await createBranchCommit(repo_directory, 'review/first', 'first.txt', [
      'first queue entry',
    ]);
    await createBranchCommit(repo_directory, 'review/second', 'second.txt', [
      'second queue entry',
    ]);
    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/first',
      run_id: 'run-1',
    });

    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });

    await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/second',
      run_id: 'run-2',
    });

    await expect(pullQueue(repo_directory)).resolves.toMatchObject({
      adopted_ready_refs: [
        expect.stringContaining('refs/queue/ready/0001-review-first'),
      ],
    });
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0002-review-second'),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});
