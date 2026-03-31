/** @import { CorePluginContext, RunCodexWith } from './types.ts' */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import { runCodex as runCodexPlugin } from './run-codex.js';
import { installFakeCodexExecutable } from '../../../test/support/runtime.js';

const COMPACT_MILESTONE_EVENTS = [
  {
    thread_id: 'thread-1',
    type: 'thread.started',
  },
  {
    item: {
      command: 'bash -lc npm test -- --runInBand',
      id: 'item-1',
      status: 'completed',
      type: 'command_execution',
    },
    type: 'item.completed',
  },
  {
    item: {
      changes: [
        {
          additions: 3,
          deletions: 1,
          path: 'lib/plugins/core/run-codex.js',
        },
        {
          additions: 4,
          deletions: 2,
          path: 'lib/plugins/core/run-codex.test.js',
        },
        {
          additions: 1,
          deletions: 0,
          path: 'test/support/runtime.js',
        },
        {
          additions: 1,
          deletions: 1,
          path: 'README.md',
        },
      ],
      id: 'item-2',
      type: 'file_changes',
    },
    type: 'item.completed',
  },
  {
    type: 'turn.completed',
  },
];

afterEach(() => {
  delete process.env.PRAVAHA_CODEX_BIN;
  delete process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT;
  delete process.env.PRAVAHA_TEST_CODEX_EXIT_CODE;
  delete process.env.PRAVAHA_TEST_CODEX_JSON_EVENTS;
  delete process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE;
  delete process.env.PRAVAHA_TEST_CODEX_STDERR;
  delete process.env.PRAVAHA_TEST_CODEX_STDOUT;
});

it('renders compact codex milestones and filters known stderr noise', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    await installCompactMilestoneScenario(temp_directory);
    const { context, log, warn } = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(runCodexPlugin.run(context)).resolves.toEqual({
      exit_code: 0,
      outcome: 'success',
      reasoning: 'medium',
      summary: 'Completed the task.',
    });
    expectCompactMilestoneLogs(log, warn);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails the run when codex exits with a failure code', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE = 'Codex failed the run.';
    process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = '2';
    const { context } = createRunCodexContext({
      prompt: 'Implement the task.',
      reasoning: 'high',
    });

    await expect(runCodexPlugin.run(context)).rejects.toThrow(
      'Codex failed the run.',
    );
    expect(context.failRun).toHaveBeenCalledWith('Codex failed the run.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('falls back to stderr when codex fails without a summary file', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = '3';
    process.env.PRAVAHA_TEST_CODEX_STDERR = 'stderr failure';
    const { context } = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(runCodexPlugin.run(context)).rejects.toThrow('stderr failure');
    expect(context.failRun).toHaveBeenCalledWith('stderr failure');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('falls back to raw stdout and generic exit messages', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_STDOUT = 'plain stdout line\n';
    process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE = 'Completed from stdout.';
    let context_bundle = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(runCodexPlugin.run(context_bundle.context)).resolves.toEqual({
      exit_code: 0,
      outcome: 'success',
      reasoning: 'medium',
      summary: 'Completed from stdout.',
    });
    expect(context_bundle.log).toHaveBeenCalledWith('codex: plain stdout line');

    delete process.env.PRAVAHA_TEST_CODEX_STDOUT;
    delete process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE;
    process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = '9';
    context_bundle = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(runCodexPlugin.run(context_bundle.context)).rejects.toThrow(
      'codex exec exited with code 9.',
    );
    expect(context_bundle.context.failRun).toHaveBeenCalledWith(
      'codex exec exited with code 9.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('falls back to structured stdout failures and launch errors', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = '4';
    process.env.PRAVAHA_TEST_CODEX_JSON_EVENTS = JSON.stringify([
      {
        item: {
          command: 'bash -lc npm test',
          id: 'item-1',
          status: 'failed',
          type: 'command_execution',
        },
        type: 'item.failed',
      },
      {
        error: {
          message: 'model aborted',
        },
        type: 'error',
      },
    ]);
    const { context } = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(runCodexPlugin.run(context)).rejects.toThrow('model aborted');
    expect(context.failRun).toHaveBeenCalledWith('model aborted');

    process.env.PRAVAHA_CODEX_BIN = join(temp_directory, 'missing-codex');

    await expect(runCodexPlugin.run(context)).rejects.toThrow('missing-codex');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {RunCodexWith} with_value
 * @returns {{
 *   context: CorePluginContext<RunCodexWith>,
 *   log: ReturnType<typeof vi.fn>,
 *   warn: ReturnType<typeof vi.fn>,
 * }}
 */
function createRunCodexContext(with_value) {
  const log = vi.fn();
  const warn = vi.fn();

  return {
    context: {
      console: {
        error: vi.fn(),
        info: vi.fn(),
        log,
        warn,
      },
      dispatchFlow: vi.fn().mockResolvedValue({}),
      failRun: vi.fn(
        /**
         * @param {string} errorMessage
         * @returns {Promise<never>}
         */
        (errorMessage) => Promise.reject(new Error(errorMessage)),
      ),
      queueWait: undefined,
      repo_directory: process.cwd(),
      requestApproval: vi.fn().mockResolvedValue(undefined),
      requestQueueWait: vi
        .fn()
        .mockRejectedValue(new Error('unused requestQueueWait')),
      run_id: 'run-1',
      doc: {
        id: 'task-1',
        path: 'docs/tasks/test.md',
        status: 'ready',
      },
      with: with_value,
      worktree_path: process.cwd(),
    },
    log,
    warn,
  };
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function installCompactMilestoneScenario(temp_directory) {
  process.env.PRAVAHA_CODEX_BIN =
    await installFakeCodexExecutable(temp_directory);
  process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT = 'Implement the task.';
  process.env.PRAVAHA_TEST_CODEX_JSON_EVENTS = JSON.stringify(
    COMPACT_MILESTONE_EVENTS,
  );
  process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE = 'Completed the task.';
  process.env.PRAVAHA_TEST_CODEX_STDERR = [
    'WARNING: proceeding, even though we could not update PATH: fake',
    'real warning',
    '',
  ].join('\n');
}

/**
 * @param {ReturnType<typeof vi.fn>} log
 * @param {ReturnType<typeof vi.fn>} warn
 * @returns {void}
 */
function expectCompactMilestoneLogs(log, warn) {
  expect(log).toHaveBeenNthCalledWith(1, 'codex: started');
  expect(log).toHaveBeenNthCalledWith(
    2,
    'codex: command bash -lc npm test -- --runInBand',
  );
  expect(log).toHaveBeenNthCalledWith(
    3,
    'codex: files lib/plugins/core/run-codex.js (+3 -1), lib/plugins/core/run-codex.test.js (+4 -2), test/support/runtime.js (+1 -0), +1 more',
  );
  expect(log).toHaveBeenNthCalledWith(4, 'codex: completed');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith('codex: real warning');
}
