/** @import { CorePluginContext, QueueHandoffWith } from './types.ts' */
import { z } from 'zod';

import { enqueueQueueHandoff } from '../../queue/queue.js';
import { definePlugin } from '../plugin-contract.js';

export default definePlugin({
  with: z.object({
    branch: z.string().min(1),
  }),
  /**
   * @param {CorePluginContext<QueueHandoffWith>} context
   * @returns {Promise<Record<string, unknown>>}
   */
  async run(context) {
    if (context.queueWait?.state === 'succeeded') {
      return {
        branch: context.queueWait.branch_ref,
        branch_head: context.queueWait.branch_head,
        ready_ref: context.queueWait.ready_ref,
        strategy: 'queue-handoff',
      };
    }

    if (context.queueWait?.state === 'failed') {
      return context.failRun(
        `Queue entry "${context.queueWait.ready_ref}" did not validate.`,
      );
    }

    if (context.queueWait?.state === 'waiting') {
      await context.requestQueueWait(context.queueWait);

      return {};
    }

    const queue_wait = await enqueueQueueHandoff(context.repo_directory, {
      branch_value: context.with.branch,
      run_id: context.run_id,
    });

    await context.requestQueueWait(queue_wait);

    return {};
  },
});
