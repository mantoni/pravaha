import {
  approve,
  defineFlow,
  run,
  runCodex,
  worktreeHandoff,
} from 'pravaha/flow';

export default defineFlow({
  on: {
    patram: '$class == task and status == ready',
  },

  workspace: 'app',

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
        Implement the task described in ${ctx.doc.path}.
        Set Status to \`done\` on completion.
      `,
      reasoning: 'high',
    });
    await approve(ctx, {
      message: 'Approve the completed Codex work for this task.',
      title: `Approve task implementation for ${ctx.doc.path}`,
    });
  },

  async onApprove(ctx) {
    await worktreeHandoff(ctx, {
      branch: `review/ready/${ctx.doc.id.replaceAll(':', '-')}`,
    });
  },
});
