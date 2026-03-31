/** @import { CorePluginContext } from './types.ts' */
import { definePlugin } from '../plugin-contract.js';
import { execGitFile } from '../../shared/git/exec-git-file.js';

const gitStatus = definePlugin({
  /**
   * @param {CorePluginContext<undefined>} context
   * @returns {Promise<{ dirty: boolean, head: string }>}
   */
  async run(context) {
    const head_result = await execGitFile(['rev-parse', 'HEAD'], {
      cwd: context.worktree_path,
      encoding: 'utf8',
    });
    const status_result = await execGitFile(['status', '--porcelain'], {
      cwd: context.worktree_path,
      encoding: 'utf8',
    });

    return {
      dirty: status_result.stdout.trim() !== '',
      head: head_result.stdout.trim(),
    };
  },
});

export { gitStatus };
