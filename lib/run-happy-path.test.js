// @module-tag lint-staged-excluded
/** @import { ThreadOptions } from '@openai/codex-sdk'; */

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

it('runs the happy path through the checked-in state-machine flow', async () => {
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

it('keeps the legacy happy-path branch working while compatibility remains', async () => {
  const temp_directory = await createFixtureRepo();
  const flow_path = join(
    temp_directory,
    'docs/flows/runtime/codex-sdk-happy-path.md',
  );

  try {
    await writeFile(flow_path, createLegacyHappyPathFlowDocument());

    const run_result = await runHappyPath(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });
    const task_text = await readFile(run_result.task_path, 'utf8');

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
      worker_thread_id: 'thread-success',
    });
    expect(task_text).toContain('Status: review');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects the happy path without explicit options when no active contract exists', async () => {
  const temp_directory = await createFixtureRepo();
  const contract_path = join(
    temp_directory,
    'docs/contracts/runtime/codex-sdk-happy-path.md',
  );

  try {
    await replaceInFile(contract_path, 'Kind: contract', 'Kind: decision');

    await expect(runHappyPath(temp_directory)).rejects.toThrow(
      'Missing active contract docs/contracts/runtime/codex-sdk-happy-path.md for the happy-path runtime.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('executes ordinary run steps before and after the worker in declared order', async () => {
  const temp_directory = await createFixtureRepo();
  const flow_path = join(
    temp_directory,
    'docs/flows/runtime/codex-sdk-happy-path.md',
  );

  try {
    await replaceInFile(
      flow_path,
      '    mode: ephemeral\n',
      '    mode: pooled\n',
    );
    await replaceInFile(
      flow_path,
      '      command: "true"\n',
      '      command: "printf \'before\\\\n\' >> step-order.log"\n',
    );
    await replaceInFile(
      flow_path,
      '      command: "printf \'\'"\n',
      '      command: "printf \'after\\\\n\' >> step-order.log"\n',
    );

    const run_result = await runHappyPath(temp_directory, {
      worker_client: createOrderingWorkerClient(),
    });
    const step_log_text = await readFile(
      join(run_result.worktree_path, 'step-order.log'),
      'utf8',
    );

    expect(step_log_text).toBe('before\nworker\nafter\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('stops on a failing core/run job and leaves the worktree in place for operators', async () => {
  const temp_directory = await createFixtureRepo();
  const flow_path = join(
    temp_directory,
    'docs/flows/runtime/codex-sdk-happy-path.md',
  );

  try {
    await replaceInFile(
      flow_path,
      '    mode: ephemeral\n',
      '    mode: pooled\n',
    );
    await replaceInFile(
      flow_path,
      '      command: "printf \'\'"\n',
      "      command: \"printf 'operator-note\\\\n' > operator-note.txt && printf 'stop\\\\n' >> step-order.log && exit 7\"\n",
    );

    const run_result = await runHappyPath(temp_directory, {
      worker_client: createOrderingWorkerClient(),
    });
    const task_text = await readFile(run_result.task_path, 'utf8');

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain(
      'State-machine ended in terminal state "failure".',
    );
    expect(task_text).toContain('Status: ready');
    await expect(access(run_result.worktree_path)).resolves.toBeUndefined();
    await expect(
      readFile(join(run_result.worktree_path, 'operator-note.txt'), 'utf8'),
    ).resolves.toBe('operator-note\n');
    await expect(
      readFile(join(run_result.worktree_path, 'step-order.log'), 'utf8'),
    ).resolves.toBe('worker\nstop\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('records worker failure in the terminal state and leaves the task ready', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const run_result = await runHappyPath(temp_directory, {
      now: () => new Date('2026-03-25T08:30:00.000Z'),
      worker_client: createFailingWorkerClient(),
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

    expect(task_text).toContain('Status: ready');
    expect(runtime_record).toMatchObject({
      format_version: 'state-machine-v2',
      job_state: {
        current_job_name: 'failed',
      },
      local_outcome: {
        state: 'failure',
      },
      selected_task: {
        id: 'implement-runtime-slice',
      },
      worker: {
        error_message: 'Codex SDK run failed',
        thread_id: 'thread-failure',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('normalizes non-Error worker failures and still reaches the failed terminal state', async () => {
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

it('creates a fresh worktree on a repeated run when the flow policy is ephemeral', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const first_run_result = await runHappyPath(temp_directory, {
      now: () => new Date('2026-03-25T08:35:00.000Z'),
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    const second_run_result = await runHappyPath(temp_directory, {
      now: () => new Date('2026-03-25T08:40:00.000Z'),
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(second_run_result.worktree_path).not.toBe(
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

it('preserves external task edits because the state-machine flow does not project task status', async () => {
  const temp_directory = await createFixtureRepo();
  const task_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );

  try {
    const run_result = await runHappyPath(temp_directory, {
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
    });

    const task_text = await readFile(task_path, 'utf8');

    expect(run_result.outcome).toBe('success');
    expect(task_text).toContain('Status: blocked');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects the happy path when the active contract cannot be found', async () => {
  const temp_directory = await createFixtureRepo();
  const contract_path = join(
    temp_directory,
    'docs/contracts/runtime/codex-sdk-happy-path.md',
  );

  try {
    await replaceInFile(contract_path, 'Kind: contract', 'Kind: decision');

    await expect(
      runHappyPath(temp_directory, {
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow(
      'Missing active contract docs/contracts/runtime/codex-sdk-happy-path.md for the happy-path runtime.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @returns {{startThread: (thread_options?: ThreadOptions) => {
 *   id: string,
 *   run: (prompt: string) => Promise<{
 *   finalResponse: string,
 *   items: Array<{id: string, text: string, type: 'agent_message'}>,
 *   usage: {cached_input_tokens: number, input_tokens: number, output_tokens: number}
 * }>
 * }}}
 *   startThread: (
 *     thread_options?: ThreadOptions,
 *   ) => {
 *     id: string,
 *     run: (
 *       prompt: string,
 *     ) => Promise<{
 *       finalResponse: string,
 *       items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *       usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 *     }>,
 *   },
 * }}
 */
function createOrderingWorkerClient() {
  return {
    startThread(thread_options) {
      return {
        id: 'thread-ordering',
        async run() {
          if (typeof thread_options?.workingDirectory !== 'string') {
            throw new Error(
              'Expected a working directory for the worker step.',
            );
          }

          await writeFile(
            join(thread_options.workingDirectory, 'step-order.log'),
            'worker\n',
            {
              flag: 'a',
            },
          );

          return createSuccessRunResult();
        },
      };
    },
  };
}

/**
 * @returns {{startThread: () => {id: string, run: () => Promise<never>}}}
 */
function createFailingWorkerClient() {
  return {
    startThread() {
      return {
        id: 'thread-failure',
        async run() {
          throw new Error('Codex SDK run failed');
        },
      };
    },
  };
}

/**
 * @returns {string}
 */
function createLegacyHappyPathFlowDocument() {
  return createFixtureDocument({
    body: [
      '# Codex SDK Happy Path',
      '',
      '```yaml',
      'kind: flow',
      'id: codex-sdk-happy-path',
      'status: active',
      'scope: contract',
      '',
      'on:',
      '  task:',
      '    where: $class == task and tracked_in == @document and status == ready',
      '',
      'jobs:',
      '  implement_task:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '```',
      '',
    ].join('\n'),
    metadata: [
      ['Kind', 'flow'],
      ['Id', 'codex-sdk-happy-path'],
      ['Status', 'active'],
    ],
  });
}
