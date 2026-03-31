import { expect, it, vi } from 'vitest';

import {
  approve,
  attachFlowRuntime,
  queueHandoff,
  run,
  runCodex,
  worktreeHandoff,
} from './built-ins.js';

it('delegates imported built-ins through the attached flow runtime', async () => {
  const ctx = attachFlowRuntime(
    {},
    {
      approve: vi.fn(() => Promise.reject(new Error('waiting'))),
      queue_handoff: vi.fn(() =>
        Promise.resolve({ ready_ref: 'refs/queue/ready/0001-demo' }),
      ),
      run: vi.fn(() => Promise.resolve({ exit_code: 0 })),
      run_codex: vi.fn(() => Promise.resolve({ outcome: 'success' })),
      worktree_handoff: vi.fn(() =>
        Promise.resolve({ branch: 'review/ready/demo' }),
      ),
    },
  );

  await expect(run(ctx, { command: 'true' })).resolves.toEqual({
    exit_code: 0,
  });
  await expect(runCodex(ctx, { prompt: 'Implement.' })).resolves.toEqual({
    outcome: 'success',
  });
  await expect(
    queueHandoff(ctx, { branch: 'review/ready/demo' }),
  ).resolves.toEqual({
    ready_ref: 'refs/queue/ready/0001-demo',
  });
  await expect(
    worktreeHandoff(ctx, { branch: 'review/ready/demo' }),
  ).resolves.toEqual({
    branch: 'review/ready/demo',
  });
  await expect(approve(ctx, { title: 'Review' })).rejects.toThrow('waiting');
});

it('rejects values that are not Pravaha flow contexts', async () => {
  await expect(run({}, { command: 'true' })).rejects.toThrow(
    'Expected a Pravaha flow ctx as the first argument.',
  );
});
