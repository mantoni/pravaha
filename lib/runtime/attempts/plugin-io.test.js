import { expect, it, vi } from 'vitest';

import {
  createPluginConsole,
  readRequiredRunId,
  resolveOperatorIo,
  writeApprovalInstruction,
} from './plugin-io.js';

it('resolves default operator io when none is provided', () => {
  const operator_io = resolveOperatorIo(undefined);

  expect(operator_io.stdout.write('ok')).toBe(true);
  expect(operator_io.stderr.write('ok')).toBe(true);
});

it('writes approval instructions and formats console values', () => {
  const stdout = {
    write: vi.fn(() => true),
  };
  const stderr = {
    write: vi.fn(() => true),
  };
  const plugin_console = createPluginConsole({
    stderr,
    stdout,
  });

  writeApprovalInstruction(stdout, 'run-123');
  plugin_console.log('hello', { ok: true }, null);
  plugin_console.info('info');
  plugin_console.warn('warn');
  plugin_console.error('error');

  expect(stdout.write).toHaveBeenNthCalledWith(
    1,
    'Approval requested. Run `pravaha approve --token run-123` to continue.\n',
  );
  expect(stdout.write).toHaveBeenNthCalledWith(2, 'hello {"ok":true} null\n');
  expect(stdout.write).toHaveBeenNthCalledWith(3, 'info\n');
  expect(stderr.write).toHaveBeenNthCalledWith(1, 'warn\n');
  expect(stderr.write).toHaveBeenNthCalledWith(2, 'error\n');
});

it('requires a non-empty stable run id', () => {
  expect(readRequiredRunId('run-123')).toBe('run-123');
  expect(() => readRequiredRunId(undefined)).toThrow(
    'Expected a stable run id for plugin execution.',
  );
  expect(() => readRequiredRunId('   ')).toThrow(
    'Expected a stable run id for plugin execution.',
  );
});
