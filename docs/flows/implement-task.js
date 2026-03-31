import { approve, defineFlow, run, runCodex, worktreeHandoff } from 'pravaha';

/**
 * @typedef {Record<string, unknown> & {
 *   task: {
 *     id: string,
 *     path: string,
 *   },
 * }} ImplementTaskFlowContext
 */

export default defineFlow({
  on: {
    patram: '$class == task and status == ready',
  },

  workspace: {
    id: 'app',
  },

  /**
   * @param {ImplementTaskFlowContext} ctx
   * @returns {Promise<void>}
   */
  async main(ctx) {
    await run(ctx, {
      command: `
        git reset --hard main
        git clean -fd
        npm ci --prefer-offline --no-audit --fund=false
      `,
    });
    await runCodex(ctx, {
      prompt: `
        Implement the task described in ${ctx.task.path}.
        Set Status to \`done\` on completion.
      `,
      reasoning: 'high',
    });
    await approve(ctx, {
      message: 'Approve the completed Codex work for this task.',
      title: `Approve task implementation for ${ctx.task.path}`,
    });
  },

  /**
   * @param {ImplementTaskFlowContext} ctx
   * @returns {Promise<void>}
   */
  async onApprove(ctx) {
    await worktreeHandoff(ctx, {
      branch: `review/ready/${ctx.task.id.replaceAll(':', '-')}`,
    });
  },
});
