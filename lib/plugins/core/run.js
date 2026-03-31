/** @import { CorePluginContext, RunWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runShellCommand } from './subprocess.js';

const run = definePlugin({
  with: z.object({
    capture: z.array(z.enum(['stderr', 'stdout'])).optional(),
    command: z.string(),
  }),
  /**
   * @param {CorePluginContext<RunWith>} context
   * @returns {Promise<Record<string, unknown>>}
   */
  async run(context) {
    try {
      const process_result = await runShellCommand(
        context.with.command,
        context.worktree_path,
      );
      const result = createRunResult(process_result, context.with.capture);

      if (process_result.exit_code !== 0) {
        await context.failRun(
          readRunFailureMessage(result, process_result.exit_code),
        );

        return {};
      }

      return result;
    } catch (error) {
      await context.failRun(readErrorMessage(error));

      return {};
    }
  },
});

export { run };

/**
 * @param {{
 *   exit_code: number,
 *   stderr: string,
 *   stdout: string,
 * }} process_result
 * @param {('stderr' | 'stdout')[] | undefined} capture
 * @returns {Record<string, unknown>}
 */
function createRunResult(process_result, capture) {
  /** @type {Record<string, unknown>} */
  const result = {
    exit_code: process_result.exit_code,
  };

  if (capture?.includes('stdout')) {
    result.stdout = process_result.stdout;
  }

  if (capture?.includes('stderr')) {
    result.stderr = process_result.stderr;
  }

  return result;
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
 * @param {Record<string, unknown>} result
 * @param {number} exit_code
 * @returns {string}
 */
function readRunFailureMessage(result, exit_code) {
  if (typeof result.stderr === 'string' && result.stderr !== '') {
    return result.stderr;
  }

  return `Command exited with code ${exit_code}.`;
}
