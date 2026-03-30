import { expect, it, vi } from 'vitest';

import { approve, attachFlowRuntime, run, runCodex } from './built-ins.js';

it('delegates imported built-ins through the attached flow runtime', async () => {
  const ctx = attachFlowRuntime(
    {},
    {
      approve: vi.fn(() => Promise.reject(new Error('waiting'))),
      run: vi.fn(() => Promise.resolve({ exit_code: 0 })),
      run_codex: vi.fn(() => Promise.resolve({ outcome: 'success' })),
    },
  );

  await expect(run(ctx, { command: 'true' })).resolves.toEqual({
    exit_code: 0,
  });
  await expect(runCodex(ctx, { prompt: 'Implement.' })).resolves.toEqual({
    outcome: 'success',
  });
  await expect(approve(ctx, { title: 'Review' })).rejects.toThrow('waiting');
});

it('rejects values that are not Pravaha flow contexts', async () => {
  await expect(run({}, { command: 'true' })).rejects.toThrow(
    'Expected a Pravaha flow ctx as the first argument.',
  );
});
