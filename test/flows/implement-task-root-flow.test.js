import { expect, it, vi } from 'vitest';

import implement_task_flow from '../../docs/flows/implement-task.js';
import { attachFlowRuntime } from '../../lib/flow/built-ins.js';

const validated_flow = /** @type {{
 *   main: (ctx: unknown) => Promise<void>,
 *   onApprove: (ctx: unknown) => Promise<void>,
 * }} */ (/** @type {unknown} */ (implement_task_flow));

it('implements the checked-in root flow through imported built-ins', async () => {
  const ctx = createFlowContext();

  await expect(validated_flow.main(ctx)).rejects.toThrow('waiting');
  const run_calls = /** @type {Array<[{ command: string }] | undefined>} */ (
    ctx.run.mock.calls
  );
  const run_codex_calls = /** @type {Array<
   *   [{ prompt: string, reasoning: string }] | undefined
   * >} */ (ctx.run_codex.mock.calls);
  const [run_call] = run_calls[0] ?? [];
  const [run_codex_call] = run_codex_calls[0] ?? [];
  if (run_call === undefined || run_codex_call === undefined) {
    throw new Error('Expected flow built-ins to be called.');
  }

  expect(ctx.run).toHaveBeenCalledTimes(1);
  expect(readNormalizedLines(run_call.command)).toEqual([
    'git reset --hard main',
    'git clean -fd',
    'npm ci --prefer-offline --no-audit --fund=false',
  ]);
  expect(ctx.run_codex).toHaveBeenCalledTimes(1);
  expect(readNormalizedLines(run_codex_call.prompt)).toEqual([
    'Implement the task described in docs/tasks/runtime/demo.md.',
    'Set Status to `done` on completion.',
  ]);
  expect(run_codex_call.reasoning).toBe('high');
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
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
      },
    },
    flow_runtime,
  );

  return Object.assign(ctx, flow_runtime);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function readNormalizedLines(value) {
  return String(value)
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
