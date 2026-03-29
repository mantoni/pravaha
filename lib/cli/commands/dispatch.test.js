import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createDispatchResult,
  createIoContext,
} from '../../../test/support/cli-command.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../../pravaha.js');
});

it('uses the explicit dispatch command context when provided', async () => {
  const io_context = createIoContext();
  const dispatchMock = vi.fn(() => Promise.resolve(createDispatchResult()));

  vi.resetModules();
  const { runDispatchCommand } = await import('./dispatch.js');

  await expect(
    runDispatchCommand([], io_context, { dispatch: dispatchMock }),
  ).resolves.toBe(0);

  expect(dispatchMock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
});

it('falls back to the canonical dispatch implementation when context is omitted', async () => {
  const io_context = createIoContext();
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));

  try {
    vi.resetModules();
    const { runDispatchCommand } = await import('./dispatch.js');

    await expect(
      runDispatchCommand([temp_directory], io_context, {}),
    ).resolves.toBe(0);
    expect(io_context.stdout_text()).toContain('"outcome": "success"');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('parses --flow and forwards it to the dispatch runtime command', async () => {
  const io_context = createIoContext();
  const dispatchMock = vi.fn(() => Promise.resolve(createDispatchResult()));

  vi.resetModules();
  const { runDispatchCommand } = await import('./dispatch.js');

  await expect(
    runDispatchCommand(['--flow', 'flow-instance:1234', '/repo'], io_context, {
      dispatch: dispatchMock,
    }),
  ).resolves.toBe(0);

  expect(dispatchMock).toHaveBeenCalledWith('/repo', {
    flow_instance_id: 'flow-instance:1234',
    operator_io: io_context,
  });
});

it('rejects dispatch --flow when the flow instance id is blank', async () => {
  const io_context = createIoContext();

  vi.resetModules();
  const { runDispatchCommand } = await import('./dispatch.js');

  await expect(
    runDispatchCommand(['--flow', '', '/repo'], io_context, {}),
  ).resolves.toBe(1);

  expect(io_context.stderr_text()).toContain(
    'Expected dispatch to receive [--flow <flow_instance_id>] [path].',
  );
});
