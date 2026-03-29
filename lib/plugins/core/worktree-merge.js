/** @import { CorePluginContext, WorktreeMergeWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runWorktreeMerge } from './worktree-integration.js';

export default definePlugin({
  with: z.object({
    message: z.string().optional(),
    target: z.string().min(1),
  }),
  /**
   * @param {CorePluginContext<WorktreeMergeWith>} context
   */
  async run(context) {
    return runWorktreeMerge(
      context.repo_directory,
      context.worktree_path,
      context.run_id,
      context.with,
    );
  },
});
