/** @import { CorePluginContext, WorktreeHandoffWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runWorktreeHandoff } from './worktree-integration.js';

export default definePlugin({
  with: z.object({
    branch: z.string().min(1).optional(),
  }),
  /**
   * @param {CorePluginContext<WorktreeHandoffWith>} context
   */
  async run(context) {
    return runWorktreeHandoff(
      context.repo_directory,
      context.worktree_path,
      context.with,
    );
  },
});
