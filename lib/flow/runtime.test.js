import { expect, it, vi } from 'vitest';

import { attachFlowRuntime, readRequiredFlowRuntime } from './runtime.js';

it('reads the attached generic plugin invocation runtime', async () => {
  const invokePlugin = vi.fn(() =>
    Promise.resolve({
      ok: true,
    }),
  );
  const ctx = attachFlowRuntime({}, { invoke_plugin: invokePlugin });

  await expect(
    readRequiredFlowRuntime(ctx).invoke_plugin(() => Promise.resolve({}), {}),
  ).resolves.toEqual({
    ok: true,
  });
});

it('rejects values that are not Pravaha flow contexts', () => {
  expect(() => readRequiredFlowRuntime({})).toThrow(
    'Expected a Pravaha flow ctx as the first argument.',
  );
});
