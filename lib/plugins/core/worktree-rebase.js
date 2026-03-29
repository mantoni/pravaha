/** @import { CorePluginContext, WorktreeRebaseWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runWorktreeRebase } from './worktree-integration.js';

export default definePlugin({
  with: z.object({
    target: z.string().min(1),
  }),
  /**
   * @param {CorePluginContext<WorktreeRebaseWith>} context
   */
  async run(context) {
    return runWorktreeRebase(
      context.repo_directory,
      context.worktree_path,
      context.run_id,
      context.with,
    );
  },
});
