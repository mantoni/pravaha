/** @import { CorePluginContext, GitMergeWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runGitMerge } from './git-integration.js';

export default definePlugin({
  with: z.object({
    head: z.string().min(1),
    message: z.string().optional(),
  }),
  /**
   * @param {CorePluginContext<GitMergeWith>} context
   */
  async run(context) {
    return runGitMerge(context.worktree_path, context.with);
  },
});
