/** @import { CorePluginContext, RunCodexWith } from './types.ts' */
import { constants as fs_constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import {
  readStructuredCodexFailure,
  renderCodexEventLine,
} from './run-codex-json.js';
import { normalizeCommandParameters, runProcess } from './subprocess.js';

const DEFAULT_REASONING = 'medium';
const FILTERED_STDERR_PREFIXES = [
  'WARNING: proceeding, even though we could not update PATH:',
];

const runCodex = definePlugin({
  with: z.object({
    prompt: z.string(),
    reasoning: z.enum(['low', 'medium', 'high']).optional(),
  }),
  /**
   * @param {CorePluginContext<RunCodexWith>} context
   * @returns {Promise<Record<string, unknown>>}
   */
  async run(context) {
    const codex_directory = await mkdtemp(join(tmpdir(), 'pravaha-codex-'));
    const output_path = join(codex_directory, 'last-message.txt');
    const reasoning = context.with.reasoning ?? DEFAULT_REASONING;

    try {
      const process_result = await runProcess({
        args: createCodexArgs(output_path, context.worktree_path),
        command: process.env.PRAVAHA_CODEX_BIN ?? 'codex',
        cwd: context.worktree_path,
        env: process.env,
        on_stderr_line(line) {
          logCodexStderrLine(context.console.warn, line);
        },
        on_stdout_line(line) {
          logCodexJsonLine(context, line);
        },
        stdin_text: context.with.prompt,
      });
      const summary = await readOutputMessage(output_path);

      if (process_result.exit_code !== 0) {
        await context.failRun(readCodexFailure(summary, process_result));

        return {};
      }

      return {
        exit_code: process_result.exit_code,
        outcome: 'success',
        reasoning,
        summary,
      };
    } catch (error) {
      await context.failRun(readErrorMessage(error));

      return {};
    } finally {
      await rm(codex_directory, { force: true, recursive: true });
    }
  },
});

export { runCodex };

/**
 * @param {string} output_path
 * @param {string} worktree_path
 * @returns {string[]}
 */
function createCodexArgs(output_path, worktree_path) {
  return normalizeCommandParameters(`
    exec
    --color
    never
    --json
    --output-last-message
    ${output_path}
    --sandbox
    workspace-write
    --cd
    ${worktree_path}
    -
  `);
}

/**
 * @param {CorePluginContext<RunCodexWith>} context
 * @param {string} line
 * @returns {void}
 */
function logCodexJsonLine(context, line) {
  const rendered_event = renderCodexEventLine(line);

  if (rendered_event === null) {
    context.console.log(`codex: ${line}`);
    return;
  }

  if (rendered_event.level === 'warn') {
    context.console.warn(`codex: ${rendered_event.text}`);
    return;
  }

  context.console.log(`codex: ${rendered_event.text}`);
}

/**
 * @param {(line: string) => void} write_line
 * @param {string} line
 * @returns {void}
 */
function logCodexStderrLine(write_line, line) {
  if (!shouldFilterLine(line)) {
    write_line(`codex: ${line}`);
  }
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function shouldFilterLine(line) {
  return FILTERED_STDERR_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * @param {string} output_path
 * @returns {Promise<string>}
 */
async function readOutputMessage(output_path) {
  if (!(await canReadFile(output_path))) {
    return '';
  }

  return (await readFile(output_path, 'utf8')).trim();
}

/**
 * @param {string} summary
 * @param {{
 *   exit_code: number,
 *   stderr: string,
 *   stdout: string,
 * }} process_result
 * @returns {string}
 */
function readCodexFailure(summary, process_result) {
  if (summary !== '') {
    return summary;
  }

  if (process_result.stderr.trim() !== '') {
    return process_result.stderr.trim();
  }

  const structured_failure = readStructuredCodexFailure(process_result.stdout);

  if (structured_failure !== null) {
    return structured_failure;
  }

  if (process_result.stdout.trim() !== '') {
    return process_result.stdout.trim();
  }

  return `codex exec exited with code ${process_result.exit_code}.`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {string} file_path
 * @returns {Promise<boolean>}
 */
async function canReadFile(file_path) {
  try {
    await access(file_path, fs_constants.R_OK);

    return true;
  } catch {
    return false;
  }
}
