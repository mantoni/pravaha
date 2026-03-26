import { z } from 'zod';

import { definePlugin } from 'pravaha';

export default definePlugin({
  emits: {
    approval_granted: z.object({
      run_id: z.string(),
      task_id: z.string(),
    }),
  },
  /**
   * @param {{
   *   emit?: unknown,
   *   requestApproval?: unknown,
   *   run_id?: unknown,
   *   task?: unknown,
   * }} context
   */
  async run(context) {
    const plugin_context = /** @type {{
     *   emit: (kind: string, payload: Record<string, unknown>) => Promise<void>,
     *   requestApproval: () => Promise<void>,
     *   run_id: string,
     *   task: { id: string },
     * }} */ (context);

    await plugin_context.requestApproval();
    await plugin_context.emit('approval_granted', {
      run_id: plugin_context.run_id,
      task_id: plugin_context.task.id,
    });
  },
});
