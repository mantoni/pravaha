import { expect, it } from 'vitest';

import {
  normalizeCommandParameters,
  runProcess,
  runShellCommand,
} from './subprocess.js';

it('captures stdout and stderr while streaming complete lines', async () => {
  /** @type {string[]} */
  const stdout_lines = [];
  /** @type {string[]} */
  const stderr_lines = [];
  const process_result = await runProcess({
    args: [
      '-e',
      [
        "process.stdin.setEncoding('utf8');",
        "let input = '';",
        "process.stdin.on('data', (chunk) => {",
        '  input += chunk;',
        '});',
        "process.stdin.on('end', () => {",
        "  process.stdout.write('first\\n');",
        "  process.stdout.write('tail');",
        "  process.stderr.write('warn\\n');",
        '  process.stderr.write(input);',
        '});',
      ].join('\n'),
    ],
    command: process.execPath,
    cwd: process.cwd(),
    on_stderr_line(line) {
      stderr_lines.push(line);
    },
    on_stdout_line(line) {
      stdout_lines.push(line);
    },
    stdin_text: 'from-stdin',
  });

  expect(process_result).toEqual({
    exit_code: 0,
    stderr: 'warn\nfrom-stdin',
    stdout: 'first\ntail',
  });
  expect(stdout_lines).toEqual(['first', 'tail']);
  expect(stderr_lines).toEqual(['warn', 'from-stdin']);
});

it('runs shell commands without requiring stream callbacks', async () => {
  const process_result = await runShellCommand(
    'printf shell-ok',
    process.cwd(),
  );

  expect(process_result).toEqual({
    exit_code: 0,
    stderr: '',
    stdout: 'shell-ok',
  });
});

it('normalizes multiline command parameters while preserving blank lines', () => {
  expect(
    normalizeCommandParameters(`
      exec
        --color
      never

        --json
    `),
  ).toEqual(['exec', '--color', 'never', '', '--json']);
});

it('defaults missing exit codes to one when a process exits by signal', async () => {
  /** @type {string[]} */
  const stdout_lines = [];
  const process_result = await runProcess({
    args: [
      '-e',
      [
        "process.stdout.write('\\n');",
        "process.kill(process.pid, 'SIGTERM');",
      ].join('\n'),
    ],
    command: process.execPath,
    cwd: process.cwd(),
    on_stdout_line(line) {
      stdout_lines.push(line);
    },
  });

  expect(process_result).toEqual({
    exit_code: 1,
    stderr: '',
    stdout: '\n',
  });
  expect(stdout_lines).toEqual([]);
});
