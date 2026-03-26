/* eslint-disable max-lines-per-function */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from './plugin.fixture-test-helpers.js';
import { runTaskAttempt } from './runtime-attempt.js';

it('runs a plugin-backed ordered step and projects a flow-local emitted signal', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/request-review.js': createPluginModuleSource({
        emits_source:
          '{ review_requested: z.object({ status: z.string(), task_id: z.string() }) }',
        run_source: [
          "    const { writeFile } = await import('node:fs/promises');",
          "    const { join } = await import('node:path');",
          "    await writeFile(join(context.worktree_path, 'review.txt'), 'requested\\n');",
          "    await context.emit('review_requested', {",
          "      status: 'review',",
          '      task_id: context.task.id,',
          '    });',
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query:
        '$class == $signal and kind == review_requested and status == review',
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/request-review',
        },
      ],
      runtime_label: 'Plugin runtime slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_conditions: {
        failure: '$class == $signal and kind == review_failed',
        success:
          '$class == $signal and kind == review_requested and status == review',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worktree_policy: {
        mode: 'ephemeral',
      },
    });
    const task_document_text = await readFile(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'utf8',
    );
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result.outcome).toBe('success');
    expect(task_document_text).toContain('Status: review');
    expect(
      await readFile(join(run_result.worktree_path, 'review.txt'), 'utf8'),
    ).toBe('requested\n');
    expect(runtime_record.signals).toMatchObject([
      {
        kind: 'review_requested',
        payload: {
          status: 'review',
          task_id: 'task:implement-runtime-slice',
        },
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('halts on the first failing plugin-backed step and leaves the worktree in place', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/fail-after-write.js': createPluginModuleSource({
        emits_source: '{ plugin_failed: z.object({ reason: z.string() }) }',
        run_source: [
          "    const { writeFile } = await import('node:fs/promises');",
          "    const { join } = await import('node:path');",
          "    await writeFile(join(context.worktree_path, 'before-failure.txt'), 'left behind\\n');",
          "    throw new Error('plugin boom');",
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query: '$class == $signal and kind == worker_completed',
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/fail-after-write',
        },
        {
          command_text: "printf 'should-not-run\\n' > after-failure.txt",
          kind: 'run',
        },
      ],
      runtime_label: 'Plugin runtime slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worktree_policy: {
        mode: 'ephemeral',
      },
    });

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain('plugin boom');
    expect(
      await readFile(
        join(run_result.worktree_path, 'before-failure.txt'),
        'utf8',
      ),
    ).toBe('left behind\n');
    await expect(
      readFile(join(run_result.worktree_path, 'after-failure.txt'), 'utf8'),
    ).rejects.toThrow();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
