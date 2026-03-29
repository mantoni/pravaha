/* eslint-disable max-lines, max-lines-per-function */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { loadStateMachineFlow } from '../flow/reconcile-flow.js';
import { execGitFile } from '../shared/git/exec-git-file.js';
import { runStateMachineAttempt } from '../runtime/attempts/state-machine.js';
import { FLOW_PATH } from '../../test/fixtures/reconcile-fixture.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../test/support/runtime-attempt-state-machine.js';
import {
  enqueueQueueHandoff,
  initQueue,
  pullQueue,
  publishQueue,
  syncQueue,
} from './queue.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

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
    await writeFile(join(repo_directory, 'shared.txt'), 'base\n');
    await execGitFile(['add', 'shared.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Add shared base'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    await createBranchCommit(repo_directory, 'review/conflict', 'shared.txt', [
      'branch',
    ]);

    await writeFile(join(repo_directory, 'shared.txt'), 'main\n');
    await execGitFile(['add', 'shared.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Conflicting main change'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

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
    await writeFile(join(repo_directory, 'shared.txt'), 'base\n');
    await execGitFile(['add', 'shared.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Add shared base'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
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
    await writeFile(join(repo_directory, 'shared.txt'), 'main\n');
    await execGitFile(['add', 'shared.txt'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(['commit', '-m', 'Conflicting main change'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
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

    expect(sync_result).toMatchObject({
      outcome: 'failure',
      rejected_ready_refs: [
        expect.stringContaining('refs/queue/ready/0002-review-conflict'),
      ],
      resumed_runs: [{ outcome: 'failure' }],
    });
    expect(sync_result.resumed_runs).toHaveLength(1);
    expect(sync_result.resumed_runs[0]?.ready_ref).toContain(
      'refs/queue/ready/0002-review-conflict',
    );
    expect(runtime_record.local_outcome.state).toBe('failure');
    expect(runtime_record.queue_wait?.state).toBe('failed');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-safe-before'),
      expect.stringContaining('refs/queue/ready/0003-review-safe-after'),
    ]);
    await expect(
      isQueueRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/safe-before'),
        queue_tip,
      ),
    ).resolves.toBe(true);
    await expect(
      isQueueRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/safe-after'),
        queue_tip,
      ),
    ).resolves.toBe(false);
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

    expect(sync_result).toMatchObject({
      outcome: 'failure',
      rejected_ready_refs: [
        expect.stringContaining('refs/queue/ready/0002-review-forbidden'),
      ],
      resumed_runs: [{ outcome: 'failure' }],
    });
    expect(sync_result.resumed_runs).toHaveLength(1);
    expect(sync_result.resumed_runs[0]?.ready_ref).toContain(
      'refs/queue/ready/0002-review-forbidden',
    );
    expect(runtime_record.local_outcome.state).toBe('failure');
    expect(runtime_record.queue_wait?.state).toBe('failed');
    await expect(listReadyRefs(repo_directory)).resolves.toEqual([
      expect.stringContaining('refs/queue/ready/0001-review-safe-before'),
      expect.stringContaining('refs/queue/ready/0003-review-safe-after'),
    ]);
    await expect(
      isQueueRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/safe-before'),
        queue_tip,
      ),
    ).resolves.toBe(true);
    await expect(
      isQueueRevisionAncestor(
        repo_directory,
        await readRevision(repo_directory, 'refs/heads/review/safe-after'),
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

/**
 * @param {{
 *   branch_step_lines: string[],
 * }} options
 * @returns {Promise<string>}
 */
async function createQueueFixtureRepo(options) {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    ...options.branch_step_lines,
  ]);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<Awaited<ReturnType<typeof runStateMachineAttempt>>>}
 */
async function startQueueRun(repo_directory) {
  const flow = await loadStateMachineFlow(repo_directory, FLOW_PATH);

  return runStateMachineAttempt(repo_directory, {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    ordered_jobs: flow.ordered_jobs,
    runtime_label: 'Queue runtime test',
    start_job_name: flow.start_job_name,
    task_id: 'implement-runtime-slice',
    task_path: TASK_PATH,
    workspace: flow.workspace,
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function createBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
) {
  await writeBranchCommit(repo_directory, branch_name, file_name, file_lines, {
    create_branch: true,
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function appendBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
) {
  await writeBranchCommit(repo_directory, branch_name, file_name, file_lines, {
    create_branch: false,
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @param {{ create_branch: boolean }} options
 * @returns {Promise<void>}
 */
async function writeBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
  options,
) {
  const checkout_arguments = options.create_branch
    ? ['checkout', '-b', branch_name]
    : ['checkout', branch_name];

  await execGitFile(checkout_arguments, {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await writeFile(
    join(repo_directory, file_name),
    `${file_lines.join('\n')}\n`,
  );
  await execGitFile(['add', file_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', `Update ${branch_name}`], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['checkout', 'main'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string[]>}
 */
async function listReadyRefs(repo_directory) {
  const { stdout } = await execGitFile(
    [
      '--git-dir',
      `${repo_directory}/.pravaha/queue.git`,
      'for-each-ref',
      '--format=%(refname)',
      'refs/queue/ready',
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} target_ref
 * @returns {Promise<void>}
 */
async function fetchQueueRef(repo_directory, source_ref, target_ref) {
  await execGitFile(
    [
      '--git-dir',
      `${repo_directory}/.pravaha/queue.git`,
      'fetch',
      repo_directory,
      `+${source_ref}:${target_ref}`,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} target_ref
 * @param {boolean} [force]
 * @returns {Promise<string>}
 */
async function pushQueueRef(
  repo_directory,
  source_ref,
  target_ref,
  force = false,
) {
  const push_arguments = ['push'];

  if (force) {
    push_arguments.push('--force');
  }

  push_arguments.push(
    `${repo_directory}/.pravaha/queue.git`,
    `${source_ref}:${target_ref}`,
  );

  const { stderr, stdout } = await execGitFile(push_arguments, {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return `${stdout}${stderr}`;
}

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(['rev-parse', revision], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} key
 * @returns {Promise<string>}
 */
async function readGitConfig(repo_directory, key) {
  const { stdout } = await execGitFile(['config', '--get', key], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} ancestor_revision
 * @param {string} descendant_revision
 * @returns {Promise<boolean>}
 */
async function isRevisionAncestor(
  repo_directory,
  ancestor_revision,
  descendant_revision,
) {
  try {
    await execGitFile(
      ['merge-base', '--is-ancestor', ancestor_revision, descendant_revision],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} ancestor_revision
 * @param {string} descendant_revision
 * @returns {Promise<boolean>}
 */
async function isQueueRevisionAncestor(
  repo_directory,
  ancestor_revision,
  descendant_revision,
) {
  try {
    await execGitFile(
      [
        '--git-dir',
        `${repo_directory}/.pravaha/queue.git`,
        'merge-base',
        '--is-ancestor',
        ancestor_revision,
        descendant_revision,
      ],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} command
 * @param {'failure' | 'success'} end_state
 * @returns {Promise<void>}
 */
async function writeQueueValidationFlow(repo_directory, command, end_state) {
  await writeFile(
    join(repo_directory, 'pravaha.json'),
    JSON.stringify(
      {
        queue: {
          validation_flow: 'docs/flows/runtime/queue-validation.yaml',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(repo_directory, 'docs/flows/runtime/queue-validation.yaml'),
    [
      'kind: flow',
      'id: queue-validation',
      'status: active',
      'scope: repo',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    id: app',
      '  materialize:',
      '    kind: worktree',
      '    mode: ephemeral',
      '    ref: main',
      '',
      'on:',
      '  task:',
      '    where: $class == task and status == ready',
      '',
      'jobs:',
      '  validate:',
      '    uses: core/run',
      '    with:',
      `      command: ${command}`,
      '    next:',
      '      - if: ${{ result.exit_code == 0 }}',
      '        goto: done',
      '      - goto: failed',
      '',
      '  done:',
      `    end: ${end_state}`,
      '',
      '  failed:',
      '    end: failure',
      '',
    ].join('\n'),
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string[]>}
 */
async function listQueueValidationRuntimeRecords(repo_directory) {
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const { stdout } = await execGitFile(
    [
      '-C',
      repo_directory,
      'ls-files',
      '--others',
      '--exclude-standard',
      runtime_directory,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('queue-validation'));
}

/**
 * @param {string} repo_directory
 * @param {string} hook_name
 * @returns {Promise<string>}
 */
async function readHook(repo_directory, hook_name) {
  return readFile(
    join(repo_directory, '.pravaha/queue.git/hooks', hook_name),
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readQueueRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(
    [
      '--git-dir',
      `${repo_directory}/.pravaha/queue.git`,
      'rev-parse',
      revision,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}

/**
 * @param {string} runtime_record_text
 * @returns {{
 *   local_outcome: { state: string },
 *   queue_wait?: { state: string },
 * }}
 */
function parseRuntimeRecord(runtime_record_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(runtime_record_text));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected runtime record JSON to evaluate to an object.');
  }

  const runtime_record = /** @type {{
   *   local_outcome: { state: string },
   *   queue_wait?: { state: string },
   * }} */ (parsed_value);

  return runtime_record;
}
