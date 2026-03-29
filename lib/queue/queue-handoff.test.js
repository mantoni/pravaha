import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { enqueueQueueHandoff } from './queue-handoff.js';
import { syncQueue } from './queue-sync.js';
import {
  createBranchCommit,
  createQueueFixtureRepo,
  fetchQueueRef,
} from './queue.test-support.js';

it('accepts explicit full branch refs when enqueuing queue handoff entries', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await createBranchCommit(
      repo_directory,
      'review/full-ref',
      'full-ref.txt',
      ['full ref'],
    );

    await expect(
      enqueueQueueHandoff(repo_directory, {
        branch_value: 'refs/heads/review/full-ref',
        run_id: 'run-1',
      }),
    ).resolves.toMatchObject({
      branch_ref: 'refs/heads/review/full-ref',
      state: 'waiting',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('ignores malformed ready-ref names when allocating the next queue position', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await createBranchCommit(
      repo_directory,
      'review/malformed',
      'malformed.txt',
      ['malformed queue entry'],
    );
    await expect(syncQueue(repo_directory)).resolves.toMatchObject({
      outcome: 'success',
    });
    await fetchQueueRef(
      repo_directory,
      'refs/heads/review/malformed',
      'refs/queue/ready/not-an-index',
    );

    const queue_wait = await enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/malformed',
      run_id: 'run-3',
    });

    expect(queue_wait.ready_ref).toContain(
      'refs/queue/ready/0001-review-malformed',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});
