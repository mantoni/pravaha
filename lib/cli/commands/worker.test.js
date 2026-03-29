/** @import { runWorkerCommand } from './worker.js' */
import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createStoppedWorkerResult,
} from '../../../test/support/cli-command.js';

const { canonicalWorkerMock } = vi.hoisted(() => ({
  canonicalWorkerMock: vi.fn(),
}));

vi.mock(import('../../pravaha.js'), () => ({
  approve: vi.fn(),
  definePlugin: vi.fn(),
  dispatch: vi.fn(),
  validateRepo: vi.fn(),
  worker: canonicalWorkerMock,
}));

afterEach(() => {
  vi.resetModules();
  canonicalWorkerMock.mockReset();
});

it('uses the explicit worker command context when provided', async () => {
  const io_context = createIoContext();
  const workerMock = vi.fn(() => Promise.resolve(createStoppedWorkerResult()));

  vi.resetModules();
  const { runWorkerCommand } = await import('./worker.js');

  await expect(
    runWorkerCommand([], io_context, { worker: workerMock }),
  ).resolves.toBe(0);

  expect(workerMock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(io_context.stdout_text()).toContain('"outcome": "stopped"');
});

it('falls back to the canonical worker implementation when context is omitted', async () => {
  const { ioContext: io_context, runWorkerCommand } =
    await loadWorkerCommandContext();

  await expect(runWorkerCommand([], io_context, {})).resolves.toBe(0);

  expect(canonicalWorkerMock).toHaveBeenCalledWith(
    process.cwd(),
    expect.any(Object),
  );
});

it('falls back to the canonical worker implementation when the command context is missing', async () => {
  const { ioContext: io_context, runWorkerCommand } =
    await loadWorkerCommandContext();

  await expect(runWorkerCommand([], io_context)).resolves.toBe(0);

  expect(canonicalWorkerMock).toHaveBeenCalledWith(
    process.cwd(),
    expect.any(Object),
  );
});

/**
 * @returns {Promise<{
 *   ioContext: ReturnType<typeof createIoContext>,
 *   runWorkerCommand: typeof runWorkerCommand,
 * }>}
 */
async function loadWorkerCommandContext() {
  vi.resetModules();
  canonicalWorkerMock.mockResolvedValue(createStoppedWorkerResult());

  return {
    ioContext: createIoContext(),
    runWorkerCommand: (await import('./worker.js')).runWorkerCommand,
  };
}
