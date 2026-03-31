/** @import { CorePluginContext, WorktreeSquashWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runWorktreeSquash } from './worktree-integration.js';

const worktreeSquash = definePlugin({
  with: z.object({
    message: z.string().optional(),
    target: z.string().min(1),
  }),
  /**
   * @param {CorePluginContext<WorktreeSquashWith>} context
   */
  async run(context) {
    return runWorktreeSquash(
      context.repo_directory,
      context.worktree_path,
      context.run_id,
      context.with,
    );
  },
});

export { worktreeSquash };
