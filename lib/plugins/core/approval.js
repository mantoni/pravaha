/** @import { ApprovalWith, CorePluginContext } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';

const approve = definePlugin({
  with: z.object({
    data: z.unknown().optional(),
    message: z.string().optional(),
    options: z.array(z.string()).optional(),
    title: z.string(),
  }),
  /**
   * @param {CorePluginContext<ApprovalWith>} context
   * @returns {Promise<{ verdict: 'approve' }>}
   */
  async run(context) {
    context.console.info(context.with.title);
    if (
      typeof context.with.message === 'string' &&
      context.with.message !== ''
    ) {
      context.console.info(context.with.message);
    }

    if (
      Array.isArray(context.with.options) &&
      context.with.options.length > 0
    ) {
      context.console.info(`Options: ${context.with.options.join(', ')}`);
    }

    await context.requestApproval();

    return {
      verdict: 'approve',
    };
  },
});

export { approve };
