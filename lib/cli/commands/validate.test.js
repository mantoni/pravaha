/** @import { runValidateCommand } from './validate.js' */

import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createSuccessfulValidationResult,
} from '../../../test/support/cli-command.js';

const { validateRepoMock } = vi.hoisted(() => ({
  validateRepoMock: vi.fn(),
}));

vi.mock(import('../../pravaha.js'), () => ({
  approve: vi.fn(),
  definePlugin: vi.fn(),
  dispatch: vi.fn(),
  validateRepo: validateRepoMock,
  worker: vi.fn(),
}));

afterEach(() => {
  vi.resetModules();
  validateRepoMock.mockReset();
});

it('renders successful validation output for an explicit repo path', async () => {
  const { ioContext: io_context, runValidateCommand } =
    await loadValidateCommandContext();

  await expect(runValidateCommand(['/repo'], io_context)).resolves.toBe(0);

  expect(validateRepoMock).toHaveBeenCalledWith('/repo');
  expect(io_context.stdout_text()).toContain('Validation passed.');
});

it('uses the current working directory when validate receives no explicit path', async () => {
  const { ioContext: io_context, runValidateCommand } =
    await loadValidateCommandContext();

  await expect(runValidateCommand([], io_context)).resolves.toBe(0);

  expect(validateRepoMock).toHaveBeenCalledWith(process.cwd());
});

/**
 * @returns {Promise<{
 *   ioContext: ReturnType<typeof createIoContext>,
 *   runValidateCommand: typeof runValidateCommand,
 * }>}
 */
async function loadValidateCommandContext() {
  vi.resetModules();
  validateRepoMock.mockResolvedValue(createSuccessfulValidationResult());

  return {
    ioContext: createIoContext(),
    runValidateCommand: (await import('./validate.js')).runValidateCommand,
  };
}
