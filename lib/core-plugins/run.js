/** @import { CorePluginContext, RunWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runShellCommand } from './subprocess.js';

export default definePlugin({
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

      return createRunResult(process_result, context.with.capture);
    } catch (error) {
      return createCommandLaunchFailure(error, context.with.capture);
    }
  },
});

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
 * @param {('stderr' | 'stdout')[] | undefined} capture
 * @returns {Record<string, unknown>}
 */
function createCommandLaunchFailure(error, capture) {
  /** @type {Record<string, unknown>} */
  const result = {
    error: readErrorMessage(error),
    exit_code: 1,
  };

  if (capture?.includes('stdout')) {
    result.stdout = '';
  }

  if (capture?.includes('stderr')) {
    result.stderr = readErrorMessage(error);
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
