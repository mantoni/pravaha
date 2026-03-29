/** @import { CorePluginContext, RunCodexWith } from './types.ts' */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import run_codex_plugin from './run-codex.js';
import { installFakeCodexExecutable } from '../../test/support/runtime.js';

afterEach(() => {
  delete process.env.PRAVAHA_CODEX_BIN;
  delete process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT;
  delete process.env.PRAVAHA_TEST_CODEX_EXIT_CODE;
  delete process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE;
  delete process.env.PRAVAHA_TEST_CODEX_STDERR;
  delete process.env.PRAVAHA_TEST_CODEX_STDOUT;
});

it('runs codex with default reasoning and filters known stderr noise', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT =
      'Use medium reasoning effort.';
    process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE = 'Completed the task.';
    process.env.PRAVAHA_TEST_CODEX_STDOUT = 'stream line\n';
    process.env.PRAVAHA_TEST_CODEX_STDERR = [
      'WARNING: proceeding, even though we could not update PATH: fake',
      'real warning',
      '',
    ].join('\n');
    const { context, log, warn } = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(run_codex_plugin.run(context)).resolves.toEqual({
      exit_code: 0,
      outcome: 'success',
      reasoning: 'medium',
      summary: 'Completed the task.',
    });
    expect(log).toHaveBeenCalledWith('codex: stream line');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('codex: real warning');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns the summary when codex exits with a failure code', async () => {
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

    await expect(run_codex_plugin.run(context)).resolves.toEqual({
      error: 'Codex failed the run.',
      exit_code: 2,
      outcome: 'failure',
    });
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

    await expect(run_codex_plugin.run(context)).resolves.toEqual({
      error: 'stderr failure',
      exit_code: 3,
      outcome: 'failure',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('falls back to stdout and launch errors when codex output is incomplete', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-test-'));

  try {
    process.env.PRAVAHA_CODEX_BIN =
      await installFakeCodexExecutable(temp_directory);
    process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = '4';
    process.env.PRAVAHA_TEST_CODEX_STDOUT = 'stdout failure';
    const { context } = createRunCodexContext({
      prompt: 'Implement the task.',
    });

    await expect(run_codex_plugin.run(context)).resolves.toEqual({
      error: 'stdout failure',
      exit_code: 4,
      outcome: 'failure',
    });

    process.env.PRAVAHA_CODEX_BIN = join(temp_directory, 'missing-codex');

    const result = /** @type {Record<string, unknown>} */ (
      await run_codex_plugin.run(context)
    );

    expect(result.outcome).toBe('failure');
    expect(result.exit_code).toBe(1);
    expect(String(result.error)).toContain('missing-codex');
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
      repo_directory: process.cwd(),
      requestApproval: vi.fn().mockResolvedValue(undefined),
      run_id: 'run-1',
      task: {
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
