import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createStoppedWorkerResult,
} from '../command.test-helpers.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../../pravaha.js');
});

it('uses the explicit worker command context when provided', async () => {
  const io_context = createIoContext();
  const worker_mock = vi.fn(async () => createStoppedWorkerResult());
  const { runWorkerCommand } = await import('./worker.js');

  await expect(
    runWorkerCommand([], io_context, { worker: worker_mock }),
  ).resolves.toBe(0);

  expect(worker_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(io_context.stdout_text()).toContain('"outcome": "stopped"');
});

it('falls back to the canonical worker implementation when context is omitted', async () => {
  const io_context = createIoContext();
  const worker_mock = vi.fn(async () => createStoppedWorkerResult());

  vi.doMock('../../pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: vi.fn(),
    validateRepo: vi.fn(),
    worker: worker_mock,
  }));

  const { runWorkerCommand } = await import('./worker.js');

  await expect(runWorkerCommand([], io_context, {})).resolves.toBe(0);

  expect(worker_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
});
