import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import { definePlugin } from 'pravaha';

const exec_file = promisify(execFile);

export default definePlugin({
  with: z.object({
    command: z.string(),
  }),
  emits: {},
  /**
   * @param {{
   *   with?: unknown,
   *   worktree_path?: unknown,
   * }} context
   */
  async run(context) {
    const plugin_context = /** @type {{
     *   with: { command: string },
     *   worktree_path: string,
     * }} */ (context);

    await runCommand(plugin_context.worktree_path, plugin_context.with.command);
  },
});

/**
 * @param {string} worktree_path
 * @param {string} command_text
 * @returns {Promise<void>}
 */
async function runCommand(worktree_path, command_text) {
  await exec_file('/bin/zsh', ['-lc', command_text], {
    cwd: worktree_path,
    encoding: 'utf8',
  });
}
