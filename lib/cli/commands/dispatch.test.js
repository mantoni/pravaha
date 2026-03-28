import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createDispatchResult,
  createIoContext,
} from '../command.test-helpers.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../../pravaha.js');
});

it('uses the explicit dispatch command context when provided', async () => {
  const io_context = createIoContext();
  const dispatch_mock = vi.fn(async () => createDispatchResult());
  const { runDispatchCommand } = await import('./dispatch.js');

  await expect(
    runDispatchCommand([], io_context, { dispatch: dispatch_mock }),
  ).resolves.toBe(0);

  expect(dispatch_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
});

it('falls back to the canonical dispatch implementation when context is omitted', async () => {
  const io_context = createIoContext();
  const dispatch_mock = vi.fn(async () => createDispatchResult());

  vi.doMock('../../pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: dispatch_mock,
    validateRepo: vi.fn(),
    worker: vi.fn(),
  }));

  const { runDispatchCommand } = await import('./dispatch.js');

  await expect(runDispatchCommand([], io_context, {})).resolves.toBe(0);

  expect(dispatch_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
});
