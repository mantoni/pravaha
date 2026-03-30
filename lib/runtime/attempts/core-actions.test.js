import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../../../test/fixtures/plugin-fixture.js';
import { executeStateMachineAction } from './core-actions.js';

it('fails clearly when plugin execution has no stable run id', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/no-run-id.js': createPluginModuleSource({
        run_source: '    return { ok: true };',
      }),
    }),
  });

  try {
    await expect(
      executeStateMachineAction(temp_directory, {
        approval: undefined,
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        current_job_name: 'inspect',
        jobs_context: {},
        now: () => new Date('2026-03-28T10:00:00.000Z'),
        run_id: null,
        uses_value: 'local/no-run-id',
        with_value: {},
        worker_thread_id: null,
        worktree_path: temp_directory,
      }),
    ).rejects.toThrow('Expected a stable run id for plugin execution.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
