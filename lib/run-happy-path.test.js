import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import { runHappyPath } from './run-happy-path.js';
import {
  assertSuccessfulRun,
  createSuccessRunResult,
  createSuccessWorkerHarness,
} from './run-happy-path.assertions-test-helpers.js';
import {
  createFixtureDocument,
  createFixtureRepo,
  replaceInFile,
} from './run-happy-path.fixture-test-helpers.js';

it('runs the happy path, prepares a worktree, and projects success to review', async () => {
  const temp_directory = await createFixtureRepo();
  const worker_harness = createSuccessWorkerHarness();

  try {
    const run_result = await runHappyPath(temp_directory, {
      now: () => new Date('2026-03-25T08:15:00.000Z'),
      worker_client: worker_harness.worker_client,
    });

    await assertSuccessfulRun(run_result, worker_harness);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects worker failure to blocked and records the error for operators', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const run_result = await runHappyPath(temp_directory, {
      now: () => new Date('2026-03-25T08:30:00.000Z'),
      worker_client: {
        startThread() {
          return {
            id: 'thread-failure',
            async run() {
              throw new Error('Codex SDK run failed');
            },
          };
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'failure',
      task_id: 'implement-runtime-slice',
      worker_thread_id: 'thread-failure',
      worker_error: 'Codex SDK run failed',
    });

    const task_text = await readFile(run_result.task_path, 'utf8');
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(task_text).toContain('Status: blocked');
    expect(runtime_record).toMatchObject({
      outcome: 'failure',
      task_id: 'implement-runtime-slice',
      worker: {
        error_message: 'Codex SDK run failed',
        thread_id: 'thread-failure',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('normalizes non-Error worker failures and still projects blocked', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const run_result = await runHappyPath(temp_directory, {
      worker_client: {
        startThread() {
          return {
            id: 'thread-string-failure',
            async run() {
              throw 'plain worker failure';
            },
          };
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'failure',
      worker_error: 'plain worker failure',
      worker_thread_id: 'thread-string-failure',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reuses the assigned worktree on a repeated run', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const first_run_result = await runHappyPath(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    await replaceInFile(
      first_run_result.task_path,
      'Status: review',
      'Status: ready',
    );

    const second_run_result = await runHappyPath(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(second_run_result.worktree_path).toBe(
      first_run_result.worktree_path,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects the run when the contract root flow metadata is missing', async () => {
  const temp_directory = await createFixtureRepo();
  const contract_path = join(
    temp_directory,
    'docs/contracts/runtime/codex-sdk-happy-path.md',
  );

  try {
    await replaceInFile(
      contract_path,
      'Root flow: docs/flows/runtime/codex-sdk-happy-path.md\n',
      '',
    );

    await expect(
      runHappyPath(temp_directory, {
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow('Missing Root flow metadata.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects the run when more than one ready task matches the contract', async () => {
  const temp_directory = await createFixtureRepo();
  const extra_task_path = join(
    temp_directory,
    'docs/tasks/runtime/second-ready-task.md',
  );

  try {
    await mkdir(dirname(extra_task_path), { recursive: true });
    await writeFile(
      extra_task_path,
      createFixtureDocument({
        body: '# Second Ready Task\n',
        metadata: [
          ['Kind', 'task'],
          ['Id', 'second-ready-task'],
          ['Status', 'ready'],
          ['Tracked in', 'docs/contracts/runtime/codex-sdk-happy-path.md'],
        ],
      }),
    );

    await expect(
      runHappyPath(temp_directory, {
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow(
      'Expected exactly one ready task for contract:codex-sdk-happy-path, found 2.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects projection when the task stops being ready before completion', async () => {
  const temp_directory = await createFixtureRepo();
  const task_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );

  try {
    await expect(
      runHappyPath(temp_directory, {
        now: () => new Date('2026-03-25T08:45:00.000Z'),
        worker_client: {
          startThread() {
            return {
              id: 'thread-race',
              async run() {
                await replaceInFile(
                  task_path,
                  'Status: ready',
                  'Status: blocked',
                );

                return createSuccessRunResult();
              },
            };
          },
        },
      }),
    ).rejects.toThrow(`Expected ${task_path} to be ready, found blocked.`);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
