/* eslint-disable max-lines-per-function */
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
  pullQueue,
  publishQueue,
  syncQueue,
} from './queue.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

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
      outcome: 'success',
    });
    const publish_result = await publishQueue(repo_directory);

    expect(publish_result).toMatchObject({
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

it('syncs an empty queue by advancing the candidate ref to the current base', async () => {
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await expect(syncQueue(repo_directory)).resolves.toEqual({
      outcome: 'success',
      rejected_ready_refs: [],
      resumed_runs: [],
    });
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
  await execGitFile(['checkout', '-b', branch_name], {
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
