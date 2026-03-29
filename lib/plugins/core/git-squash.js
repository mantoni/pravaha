/** @import { CorePluginContext, GitSquashWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runGitSquash } from './git-integration.js';

export default definePlugin({
  with: z.object({
    head: z.string().min(1),
    message: z.string().optional(),
  }),
  /**
   * @param {CorePluginContext<GitSquashWith>} context
   */
  async run(context) {
    return runGitSquash(context.worktree_path, context.with);
  },
});
