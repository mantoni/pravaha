import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createSuccessfulValidationResult,
} from '../command.test-helpers.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../../pravaha.js');
});

it('renders successful validation output for an explicit repo path', async () => {
  const io_context = createIoContext();
  const validate_repo_mock = vi.fn(async () =>
    createSuccessfulValidationResult(),
  );

  vi.doMock('../../pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: vi.fn(),
    validateRepo: validate_repo_mock,
    worker: vi.fn(),
  }));

  const { runValidateCommand } = await import('./validate.js');

  await expect(runValidateCommand(['/repo'], io_context)).resolves.toBe(0);

  expect(validate_repo_mock).toHaveBeenCalledWith('/repo');
  expect(io_context.stdout_text()).toContain('Validation passed.');
});

it('uses the current working directory when validate receives no explicit path', async () => {
  const io_context = createIoContext();
  const validate_repo_mock = vi.fn(async () =>
    createSuccessfulValidationResult(),
  );

  vi.doMock('../../pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: vi.fn(),
    validateRepo: validate_repo_mock,
    worker: vi.fn(),
  }));

  const { runValidateCommand } = await import('./validate.js');

  await expect(runValidateCommand([], io_context)).resolves.toBe(0);

  expect(validate_repo_mock).toHaveBeenCalledWith(process.cwd());
});
