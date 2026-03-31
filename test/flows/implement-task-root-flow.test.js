import { expect, it, vi } from 'vitest';

import implement_task_flow from '../../flows/implement-task.js';
import { approve, run, runCodex, worktreeHandoff } from '../../lib/flow.js';
import { attachFlowRuntime } from '../../lib/flow/runtime.js';

const validated_flow = /** @type {{
 *   main: (ctx: unknown) => Promise<void>,
 *   onApprove: (ctx: unknown) => Promise<void>,
 * }} */ (/** @type {unknown} */ (implement_task_flow));

it('implements the checked-in root flow through imported callable plugins', async () => {
  const ctx = createFlowContext();

  await expect(validated_flow.main(ctx)).rejects.toThrow('waiting');
  expect(ctx.invokePlugin).toHaveBeenCalledTimes(3);
  const invoke_plugin_calls = /** @type {Array<
   *   [Function, { command?: string, prompt?: string, reasoning?: string, message?: string, title?: string }]
   * >} */ (ctx.invokePlugin.mock.calls);
  const [run_call, run_codex_call, approve_call] = invoke_plugin_calls;
  if (
    run_call === undefined ||
    run_codex_call === undefined ||
    approve_call === undefined
  ) {
    throw new Error('Expected flow plugins to be called.');
  }

  expect(run_call[0]).toBe(run);
  expect(readNormalizedLines(run_call[1].command)).toEqual([
    'git reset --hard main',
    'git clean -fd',
    'npm ci --prefer-offline --no-audit --fund=false',
  ]);
  expect(run_codex_call[0]).toBe(runCodex);
  expect(readNormalizedLines(run_codex_call[1].prompt)).toEqual([
    'Implement the task described in docs/tasks/runtime/demo.md.',
    'Set Status to `done` on completion.',
  ]);
  expect(run_codex_call[1].reasoning).toBe('high');
  expect(approve_call[0]).toBe(approve);
  expect(approve_call[1]).toEqual({
    message: 'Approve the completed Codex work for this task.',
    title: 'Approve task implementation for docs/tasks/runtime/demo.md',
  });
});

it('hands approved work off to the review branch', async () => {
  const ctx = createFlowContext();

  await expect(validated_flow.onApprove(ctx)).resolves.toBeUndefined();
  expect(ctx.invokePlugin).toHaveBeenCalledWith(worktreeHandoff, {
    branch: 'review/ready/task-demo',
  });
});

/**
 * @returns {Record<string, unknown> & {
 *   invokePlugin: ReturnType<typeof vi.fn>,
 * }}
 */
function createFlowContext() {
  const invokePlugin = vi.fn((plugin_definition) => {
    if (plugin_definition === approve) {
      return Promise.reject(new Error('waiting'));
    }

    if (plugin_definition === worktreeHandoff) {
      return Promise.resolve({ branch: 'review/ready/task-demo' });
    }

    if (plugin_definition === runCodex) {
      return Promise.resolve({ outcome: 'success' });
    }

    return Promise.resolve({ exit_code: 0 });
  });
  const ctx = attachFlowRuntime(
    {
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
      },
    },
    {
      invoke_plugin: invokePlugin,
    },
  );

  return Object.assign(ctx, { invokePlugin });
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
