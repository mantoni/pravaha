import { expect, it, vi } from 'vitest';

import implement_task_flow from '../../docs/flows/implement-task.js';
import { attachFlowRuntime } from '../../lib/flow/built-ins.js';

const validated_flow = /** @type {{
 *   main: (ctx: Record<string, unknown>) => Promise<void>,
 *   onApprove: (ctx: Record<string, unknown>) => Promise<void>,
 * }} */ (implement_task_flow);

it('implements the checked-in root flow through imported built-ins', async () => {
  const ctx = createFlowContext();

  await expect(validated_flow.main(ctx)).rejects.toThrow('waiting');

  expect(ctx.run).toHaveBeenNthCalledWith(1, {
    command: 'git reset --hard main && git clean -fd',
  });
  expect(ctx.run).toHaveBeenNthCalledWith(2, {
    command: 'npm ci --prefer-offline --no-audit --fund=false',
  });
  expect(ctx.run_codex).toHaveBeenCalledWith({
    prompt:
      'Implement the task described in docs/tasks/runtime/demo.md.\nSet Status to `done` on completion.',
    reasoning: 'high',
  });
  expect(ctx.approve).toHaveBeenCalledWith({
    message: 'Approve the completed Codex work for this task.',
    title: 'Approve task implementation for docs/tasks/runtime/demo.md',
  });
});

it('hands approved work off to the review branch', async () => {
  const ctx = createFlowContext();

  await expect(validated_flow.onApprove(ctx)).resolves.toBeUndefined();
  expect(ctx.worktree_handoff).toHaveBeenCalledWith({
    branch: 'review/ready/task-demo',
  });
});

/**
 * @returns {Record<string, unknown> & {
 *   approve: ReturnType<typeof vi.fn>,
 *   run: ReturnType<typeof vi.fn>,
 *   run_codex: ReturnType<typeof vi.fn>,
 *   worktree_handoff: ReturnType<typeof vi.fn>,
 * }}
 */
function createFlowContext() {
  const flow_runtime = {
    approve: vi.fn(() => Promise.reject(new Error('waiting'))),
    run: vi.fn(() => Promise.resolve({ exit_code: 0 })),
    run_codex: vi.fn(() => Promise.resolve({ outcome: 'success' })),
    worktree_handoff: vi.fn(() =>
      Promise.resolve({ branch: 'review/ready/task-demo' }),
    ),
  };
  const ctx = attachFlowRuntime(
    {
      task: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
      },
    },
    flow_runtime,
  );

  return Object.assign(ctx, flow_runtime);
}
