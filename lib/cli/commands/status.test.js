import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createStatusResult,
} from '../../../test/support/cli-command.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../../pravaha.js');
});

it('uses the explicit status command context when provided', async () => {
  const io_context = createIoContext();
  const statusMock = vi.fn(() => Promise.resolve(createStatusResult()));

  vi.resetModules();
  const { runStatusCommand } = await import('./status.js');

  await expect(
    runStatusCommand([], io_context, { status: statusMock }),
  ).resolves.toBe(0);

  expect(statusMock).toHaveBeenCalledWith(process.cwd());
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
});

it('falls back to the canonical status implementation when context is omitted', async () => {
  const io_context = createIoContext();
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-status-'));

  try {
    vi.resetModules();
    const { runStatusCommand } = await import('./status.js');

    await expect(
      runStatusCommand([temp_directory], io_context, {}),
    ).resolves.toBe(0);
    expect(io_context.stdout_text()).toContain('"outcome": "success"');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects extra status command arguments', async () => {
  const io_context = createIoContext();

  vi.resetModules();
  const { runStatusCommand } = await import('./status.js');

  await expect(
    runStatusCommand(['/repo', '/extra'], io_context, {}),
  ).resolves.toBe(1);

  expect(io_context.stderr_text()).toContain(
    'Expected status to receive [path].',
  );
});
