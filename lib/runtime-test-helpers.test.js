import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { expect, it } from 'vitest';

import {
  createSuccessRunResult,
  installFakeCodexExecutable,
} from './runtime-test-helpers.js';
import { runProcess } from './core-plugins/subprocess.js';

it('returns a stable success run result fixture', () => {
  expect(createSuccessRunResult()).toEqual({
    finalResponse: JSON.stringify({
      summary: 'Observed the ready task and reported completion.',
    }),
    items: [
      {
        id: 'message-1',
        text: 'Observed the ready task and reported completion.',
        type: 'agent_message',
      },
    ],
    usage: {
      cached_input_tokens: 0,
      input_tokens: 120,
      output_tokens: 40,
    },
  });
});

it('installs a fake codex executable that honors the test environment contract', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-runtime-test-'));

  try {
    const executable_path = await installFakeCodexExecutable(temp_directory);
    const output_path = join(temp_directory, 'last-message.txt');
    const process_result = await runProcess({
      args: ['exec', '--output-last-message', output_path, '-'],
      command: executable_path,
      cwd: temp_directory,
      env: {
        ...process.env,
        PRAVAHA_TEST_CODEX_EXPECT_PROMPT: 'Expected prompt',
        PRAVAHA_TEST_CODEX_EXIT_CODE: '7',
        PRAVAHA_TEST_CODEX_LAST_MESSAGE: 'Saved summary',
        PRAVAHA_TEST_CODEX_STDERR: 'stderr text',
        PRAVAHA_TEST_CODEX_STDOUT: 'stdout text',
      },
      stdin_text: 'Expected prompt',
    });

    expect(process_result).toEqual({
      exit_code: 7,
      stderr: 'stderr text',
      stdout: 'stdout text',
    });
    await expect(readFile(output_path, 'utf8')).resolves.toBe('Saved summary');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
