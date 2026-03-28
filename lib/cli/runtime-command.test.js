import process from 'node:process';

import { expect, it } from 'vitest';

import { createIoContext } from './command.test-helpers.js';
import {
  runRuntimeCommand,
  runRuntimeCommandWithOptions,
} from './runtime-command.js';

it('writes failure outcomes and caught runtime errors through runtime-command helpers', async () => {
  const failure_io_context = createIoContext();
  const error_io_context = createIoContext();

  await expect(
    runRuntimeCommandWithOptions(
      '/repo',
      failure_io_context,
      async () => ({ outcome: 'failure' }),
      { reason: 'broken' },
    ),
  ).resolves.toBe(1);
  await expect(
    runRuntimeCommandWithOptions(
      '/repo',
      error_io_context,
      async () => {
        throw new Error('runtime boom');
      },
      {},
    ),
  ).resolves.toBe(1);

  expect(failure_io_context.stderr_text()).toContain('"outcome": "failure"');
  expect(error_io_context.stderr_text()).toContain('runtime boom');
});

it('uses the current working directory when runRuntimeCommand receives no path', async () => {
  const io_context = createIoContext();
  /**
   * @param {string} repo_directory
   * @returns {Promise<{ outcome: string }>}
   */
  const runtime_command = async (repo_directory) => ({
    outcome: repo_directory,
  });

  await expect(
    runRuntimeCommand([], io_context, runtime_command),
  ).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain(process.cwd());
});
