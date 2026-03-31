/** @import { CorePluginContext, GitRebaseWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';
import { runGitRebase } from './git-integration.js';

const gitRebase = definePlugin({
  with: z.object({
    head: z.string().min(1),
  }),
  /**
   * @param {CorePluginContext<GitRebaseWith>} context
   */
  async run(context) {
    return runGitRebase(context.worktree_path, context.with);
  },
});

export { gitRebase };
