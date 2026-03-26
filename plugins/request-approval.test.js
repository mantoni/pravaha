import { expect, it } from 'vitest';

import request_approval_plugin from './request-approval.js';

it('requests approval before emitting the generic approval signal', async () => {
  /** @type {string[]} */
  const call_order = [];
  /** @type {Array<{ kind: string, payload: Record<string, unknown> }>} */
  const emitted_signals = [];

  await request_approval_plugin.run({
    /**
     * @param {string} kind
     * @param {Record<string, unknown>} payload
     */
    async emit(kind, payload) {
      call_order.push(`emit:${kind}`);
      emitted_signals.push({ kind, payload });
    },
    async requestApproval() {
      call_order.push('requestApproval');
    },
    run_id: 'run:implement-runtime-slice:2026-03-26T10:00:00.000Z',
    task: {
      id: 'task:implement-runtime-slice',
    },
  });

  expect(call_order).toEqual(['requestApproval', 'emit:approval_granted']);
  expect(emitted_signals).toEqual([
    {
      kind: 'approval_granted',
      payload: {
        run_id: 'run:implement-runtime-slice:2026-03-26T10:00:00.000Z',
        task_id: 'task:implement-runtime-slice',
      },
    },
  ]);
});
