/** @import * as node$w$child_process from 'node:child_process'; */
import { promisify } from 'node:util';

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

it('rejects a ready-task record without a stable Patram id and path', async () => {
  vi.doMock('node:child_process', () => ({
    execFile: createExecFileMock(() =>
      JSON.stringify({
        results: [{}],
      }),
    ),
  }));

  const { selectReadyTask } = await import('./run-happy-path-files.js');

  await expect(selectReadyTask('/repo')).rejects.toThrow(
    'Patram returned an invalid ready task record.',
  );
});

it('selects the active contract and the only ready task from patram json output', async () => {
  vi.doMock('node:child_process', () => ({
    execFile: createExecFileMock(createPatramStdout),
  }));
  vi.doMock('node:fs/promises', async () => {
    const actual_module = await vi.importActual('node:fs/promises');

    return {
      ...actual_module,
      readFile: async () =>
        '---\nRoot flow: docs/flows/runtime/codex-sdk-happy-path.md\n---\n',
    };
  });

  const { selectActiveContract, selectReadyTask } =
    await import('./run-happy-path-files.js');

  await expect(selectActiveContract('/repo')).resolves.toEqual({
    contract_path: 'docs/contracts/runtime/codex-sdk-happy-path.md',
    root_flow_path: 'docs/flows/runtime/codex-sdk-happy-path.md',
  });
  await expect(selectReadyTask('/repo')).resolves.toEqual({
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
  });
});

it('rejects missing or mismatched happy-path contract metadata', async () => {
  vi.doMock('node:child_process', () => ({
    execFile: createExecFileMock(() =>
      JSON.stringify({
        results: [],
      }),
    ),
  }));

  const { selectActiveContract } = await import('./run-happy-path-files.js');

  await expect(selectActiveContract('/repo')).rejects.toThrow(
    'Missing active contract docs/contracts/runtime/codex-sdk-happy-path.md for the happy-path runtime.',
  );
});

/**
 * @param {string[]} arguments_
 * @returns {string}
 */
function createPatramStdout(arguments_) {
  if (arguments_.includes('active-contracts')) {
    return JSON.stringify({
      results: [
        {
          $id: 'contract:codex-sdk-happy-path',
          $path: 'docs/contracts/runtime/codex-sdk-happy-path.md',
        },
      ],
    });
  }

  return JSON.stringify({
    results: [
      {
        $id: 'task:implement-runtime-slice',
        $path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
    ],
  });
}

/**
 * @param {(arguments_: string[]) => string} create_stdout
 * @returns {typeof node$w$child_process.execFile}
 */
function createExecFileMock(create_stdout) {
  const promisified_exec_file = /** @type {(
    file: string,
    arguments_: string[],
    options: unknown,
  ) => Promise<{ stderr: string, stdout: string }>} */ (
    async (file, arguments_, options) => {
      void file;
      void options;

      return {
        stderr: '',
        stdout: create_stdout(arguments_),
      };
    }
  );

  return /** @type {typeof node$w$child_process.execFile} */ (
    /** @type {unknown} */ (
      Object.assign(
        /**
         * @param {string} file
         * @param {string[]} arguments_
         * @param {unknown} options
         * @param {(error: Error | null, stdout: string, stderr: string) => void} callback
         */
        (file, arguments_, options, callback) => {
          void file;
          void options;
          callback(null, create_stdout(arguments_), '');
        },
        {
          __promisify__: promisified_exec_file,
          [promisify.custom]: promisified_exec_file,
        },
      )
    )
  );
}
