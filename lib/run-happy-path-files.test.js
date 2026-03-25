import { promisify } from 'node:util';

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

it('rejects a ready-task record without a stable Patram id and path', async () => {
  vi.doMock('node:child_process', () => ({
    execFile: Object.assign(
      /**
       * @param {string} file
       * @param {string[]} arguments_
       * @param {unknown} options
       * @param {(error: Error | null, stdout: string, stderr: string) => void} callback
       */
      (file, arguments_, options, callback) => {
        callback(
          null,
          JSON.stringify({
            results: [{}],
          }),
          '',
        );
      },
      {
        [promisify.custom]: async () => ({
          stderr: '',
          stdout: JSON.stringify({
            results: [{}],
          }),
        }),
      },
    ),
  }));

  const { selectReadyTask } = await import('./run-happy-path-files.js');

  await expect(selectReadyTask('/repo')).rejects.toThrow(
    'Patram returned an invalid ready task record.',
  );
});
