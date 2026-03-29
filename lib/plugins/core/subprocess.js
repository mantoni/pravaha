import { spawn } from 'node:child_process';
import process from 'node:process';

export { runProcess, runShellCommand };

/**
 * @param {{
 *   args?: string[],
 *   command: string,
 *   cwd: string,
 *   env?: NodeJS.ProcessEnv,
 *   on_stderr_line?: (line: string) => void,
 *   on_stdout_line?: (line: string) => void,
 *   stdin_text?: string,
 * }} options
 * @returns {Promise<{
 *   exit_code: number,
 *   stderr: string,
 *   stdout: string,
 * }>}
 */
async function runProcess(options) {
  return new Promise((resolve, reject) => {
    const child_process = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout_text = '';
    let stderr_text = '';
    let stdout_remainder = '';
    let stderr_remainder = '';

    child_process.on('error', reject);
    child_process.stdout.setEncoding('utf8');
    child_process.stderr.setEncoding('utf8');
    child_process.stdout.on('data', (chunk) => {
      const chunk_text = String(chunk);

      stdout_text += chunk_text;
      stdout_remainder = writeChunkLines(
        stdout_remainder,
        chunk_text,
        options.on_stdout_line,
      );
    });
    child_process.stderr.on('data', (chunk) => {
      const chunk_text = String(chunk);

      stderr_text += chunk_text;
      stderr_remainder = writeChunkLines(
        stderr_remainder,
        chunk_text,
        options.on_stderr_line,
      );
    });
    child_process.on('close', (exit_code) => {
      flushLine(stdout_remainder, options.on_stdout_line);
      flushLine(stderr_remainder, options.on_stderr_line);
      resolve({
        exit_code: exit_code ?? 1,
        stderr: stderr_text,
        stdout: stdout_text,
      });
    });

    if (typeof options.stdin_text === 'string') {
      child_process.stdin.end(options.stdin_text);
      return;
    }

    child_process.stdin.end();
  });
}

/**
 * @param {string} command
 * @param {string} cwd
 * @returns {Promise<{
 *   exit_code: number,
 *   stderr: string,
 *   stdout: string,
 * }>}
 */
function runShellCommand(command, cwd) {
  return runProcess({
    args: ['-c', command],
    command: '/bin/sh',
    cwd,
    env: process.env,
  });
}

/**
 * @param {string} remainder
 * @param {string} chunk
 * @param {((line: string) => void) | undefined} on_line
 * @returns {string}
 */
function writeChunkLines(remainder, chunk, on_line) {
  const text = `${remainder}${chunk}`;
  const lines = text.split('\n');
  const trailing_line = lines.pop() ?? '';

  for (const line of lines) {
    flushLine(line, on_line);
  }

  return trailing_line;
}

/**
 * @param {string} line
 * @param {((line: string) => void) | undefined} on_line
 * @returns {void}
 */
function flushLine(line, on_line) {
  if (typeof on_line !== 'function' || line === '') {
    return;
  }

  on_line(line);
}
