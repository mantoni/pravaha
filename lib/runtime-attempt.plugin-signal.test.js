import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import {
  createPluginFixtureRepo,
  createPluginModuleSource,
} from './plugin.fixture-test-helpers.js';
import { runTaskAttempt } from './runtime-attempt.js';

const BASE_PLUGIN_FIXTURE_FILES = {
  [CONTRACT_PATH]: [
    '---',
    'Kind: contract',
    'Id: single-task-flow-reconciler',
    'Status: active',
    `Root flow: ${FLOW_PATH}`,
    '---',
    '# Single-Task Flow Reconciler',
    '',
  ].join('\n'),
  [FLOW_PATH]: [
    '---',
    'Kind: flow',
    'Id: single-task-flow-reconciler',
    'Status: active',
    '---',
    '# Single-Task Flow Reconciler',
    '',
    '```yaml',
    'jobs: {}',
    '```',
    '',
  ].join('\n'),
  'docs/decisions/runtime/codex-sdk-happy-path-backend.md': [
    '---',
    'Kind: decision',
    'Id: codex-sdk-happy-path-backend',
    'Status: accepted',
    'Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md',
    '---',
    '# Codex SDK Happy Path Backend',
    '',
  ].join('\n'),
  'docs/plans/repo/v0.1/pravaha-flow-runtime.md': [
    '---',
    'Kind: plan',
    'Id: pravaha-flow-runtime',
    'Status: active',
    '---',
    '# Runtime Plan',
    '',
  ].join('\n'),
  'docs/tasks/runtime/implement-runtime-slice.md': [
    '---',
    'Kind: task',
    'Id: implement-runtime-slice',
    'Status: ready',
    `Tracked in: ${CONTRACT_PATH}`,
    '---',
    '# Implement Runtime Slice',
    '',
  ].join('\n'),
};

it('treats the first emitted signal as completion of the plugin step', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginFixtureFiles({
      'plugins/request-review.js': createPluginModuleSource({
        emits_source: '{ review_requested: z.object({ status: z.string() }) }',
        run_source: [
          "    await context.emit('review_requested', { status: 'review' });",
          "    const { writeFile } = await import('node:fs/promises');",
          "    const { join } = await import('node:path');",
          "    await writeFile(join(context.worktree_path, 'after-first-emit.txt'), 'should not happen\\n');",
          "    await context.emit('review_requested', { status: 'second' });",
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createPluginRunOptions(),
    );
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.signals).toMatchObject([
      {
        kind: 'review_requested',
        payload: {
          status: 'review',
        },
      },
    ]);
    expect(runtime_record.signals).toHaveLength(1);
    await expect(
      readFile(join(run_result.worktree_path, 'after-first-emit.txt'), 'utf8'),
    ).rejects.toThrow();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects plugin-emitted payloads that do not match the declared schema', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginFixtureFiles({
      'plugins/request-review.js': createPluginModuleSource({
        emits_source:
          '{ review_requested: z.object({ status: z.string(), attempt: z.number() }) }',
        run_source: [
          "    await context.emit('review_requested', {",
          "      attempt: 'first',",
          "      status: 'review',",
          '    });',
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createPluginRunOptions({
        transition_conditions: undefined,
        transition_target_bindings: undefined,
      }),
    );
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain(
      'Invalid input: expected number, received string',
    );
    expect(runtime_record.signals).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects undeclared plugin-emitted signal kinds', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginFixtureFiles({
      'plugins/request-review.js': createPluginModuleSource({
        emits_source: '{ review_requested: z.object({ status: z.string() }) }',
        run_source: [
          "    await context.emit('review_completed', { status: 'done' });",
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(
      temp_directory,
      createPluginRunOptions({
        transition_conditions: undefined,
        transition_target_bindings: undefined,
      }),
    );

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain(
      'cannot emit undeclared signal "review_completed"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('exposes a stable run-scoped id and limits emitted subjects to current bindings', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createRunScopedSignalFixtureFiles(),
  });

  try {
    await assertRunScopedSignalBindings(temp_directory);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {Record<string, string>} extra_fixture_files
 * @returns {Record<string, string>}
 */
function createPluginFixtureFiles(extra_fixture_files) {
  return { ...BASE_PLUGIN_FIXTURE_FILES, ...extra_fixture_files };
}

/**
 * @param {Partial<Parameters<typeof runTaskAttempt>[1]>} [overrides]
 * @returns {Parameters<typeof runTaskAttempt>[1]}
 */
function createPluginRunOptions(overrides = {}) {
  return {
    await_query:
      overrides.await_query ??
      '$class == $signal and kind == review_requested and status == review',
    binding_targets: overrides.binding_targets,
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
    transition_conditions: overrides.transition_conditions ?? {
      failure: '$class == $signal and kind == review_failed',
      success:
        '$class == $signal and kind == review_requested and status == review',
    },
    transition_target_bindings: overrides.transition_target_bindings ?? {
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
  };
}

/**
 * @returns {{
 *   document: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createRunScopedSignalBindings() {
  return {
    document: {
      id: 'contract:parent-contract',
      path: 'docs/contracts/runtime/parent-contract.md',
      status: 'active',
    },
    task: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  };
}

/**
 * @returns {Record<string, string>}
 */
function createRunScopedSignalFixtureFiles() {
  return createPluginFixtureFiles({
    'docs/contracts/runtime/parent-contract.md': [
      '---',
      'Kind: contract',
      'Id: parent-contract',
      'Status: active',
      '---',
      '# Parent Contract',
      '',
    ].join('\n'),
    'plugins/request-review.js': createPluginModuleSource({
      emits_source:
        '{ review_requested: z.object({ run_id: z.string(), task_id: z.string() }) }',
      run_source: [
        "    await context.emit('review_requested', {",
        '      run_id: context.run_id,',
        '      task_id: context.task.id,',
        '    });',
      ].join('\n'),
    }),
  });
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function assertRunScopedSignalBindings(temp_directory) {
  const run_result = await runTaskAttempt(
    temp_directory,
    createPluginRunOptions({
      await_query:
        '$class == $signal and kind == review_requested and subject == task',
      binding_targets: createRunScopedSignalBindings(),
      transition_conditions: {
        failure: '$class == $signal and kind == review_failed',
        success:
          '$class == $signal and kind == review_requested and subject == task',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
    }),
  );
  const runtime_record = JSON.parse(
    await readFile(run_result.runtime_record_path, 'utf8'),
  );
  const runtime_signals =
    /** @type {Array<{
     *   payload: Record<string, unknown>,
     *   run_id?: string,
     *   subject: 'document' | 'task',
     * }>} */
    (runtime_record.signals);

  expect(run_result.outcome).toBe('success');
  expect(runtime_record.execution.run_id).toEqual(expect.any(String));
  expect(new Set(runtime_signals.map((signal) => signal.subject))).toEqual(
    new Set(['document', 'task']),
  );
  expect(runtime_signals).toHaveLength(2);
  for (const signal of runtime_signals) {
    expect(signal.run_id).toBe(runtime_record.execution.run_id);
    expect(signal.payload).toMatchObject({
      run_id: runtime_record.execution.run_id,
      task_id: 'implement-runtime-slice',
    });
  }
}
