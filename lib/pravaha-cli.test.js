import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import package_json from '../package.json' with { type: 'json' };

import { main } from './pravaha-cli.js';

it('renders help when no command is provided', async () => {
  const io_context = createIoContext();

  await expect(main([], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('pravaha help');
});

it('prints the package version', async () => {
  const io_context = createIoContext();

  await expect(main(['version'], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toBe(`${package_json.version}\n`);
});

it('validates the repo config and checked-in flows', async () => {
  const io_context = createIoContext();
  const repo_directory = dirname(
    fileURLToPath(new URL('../package.json', import.meta.url)),
  );

  await expect(main(['validate', repo_directory], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('Validation passed.');
});

it('reports validation failures and pluralizes the checked flow count', async () => {
  const io_context = createIoContext();

  await expect(
    main(['validate', '/definitely/missing'], io_context),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('Validation failed.');
  expect(io_context.stderr_text()).toContain('Checked 0 flow documents.');
});

it('reports unknown commands to stderr', async () => {
  const io_context = createIoContext();

  await expect(main(['unknown'], io_context)).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('Unknown command: unknown');
});

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout_text: () => string,
 * }}
 */
function createIoContext() {
  let stdout = '';
  let stderr = '';

  return {
    stderr: {
      write(chunk) {
        stderr += chunk;

        return true;
      },
    },
    stderr_text() {
      return stderr;
    },
    stdout: {
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stdout_text() {
      return stdout;
    },
  };
}
