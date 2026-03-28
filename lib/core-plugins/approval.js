/** @import { ApprovalWith, CorePluginContext } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';

export default definePlugin({
  with: z.object({
    message: z.string(),
    options: z.array(z.string()),
    title: z.string(),
  }),
  /**
   * @param {CorePluginContext<ApprovalWith>} context
   * @returns {Promise<{ verdict: 'approve' }>}
   */
  async run(context) {
    context.console.info(context.with.title);
    context.console.info(context.with.message);

    if (context.with.options.length > 0) {
      context.console.info(`Options: ${context.with.options.join(', ')}`);
    }

    await context.requestApproval();

    return {
      verdict: 'approve',
    };
  },
});
