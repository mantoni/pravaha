/* eslint-disable max-lines-per-function */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from './plugin.fixture-test-helpers.js';
import { resumeTaskAttempt, runTaskAttempt } from './runtime-attempt.js';

it('provides a plugin console helper that writes operator-facing output', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/log-and-emit.js': createPluginModuleSource({
        emits_source: '{ logged: z.object({ ok: z.boolean() }) }',
        run_source: [
          "    context.console.log('log', { mode: 'log' });",
          "    context.console.info('info', { mode: 'info' });",
          "    context.console.warn('warn', { mode: 'warn' });",
          "    context.console.error('error', { mode: 'error' });",
          "    await context.emit('logged', { ok: true });",
        ].join('\n'),
      }),
    }),
  });
  const io_context = createIoContext();

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query: '$class == $signal and kind == logged and subject == task',
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      operator_io: io_context,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/log-and-emit',
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

    expect(run_result.outcome).toBe('success');
    expect(io_context.stdout_text()).toContain('log {"mode":"log"}');
    expect(io_context.stdout_text()).toContain('info {"mode":"info"}');
    expect(io_context.stderr_text()).toContain('warn {"mode":"warn"}');
    expect(io_context.stderr_text()).toContain('error {"mode":"error"}');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails plugin execution when a bound task context is missing', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'docs/contracts/runtime/parent-contract.md': [
        '---',
        'Kind: contract',
        'Id: parent-contract',
        'Status: active',
        '---',
        '# Parent Contract',
        '',
      ].join('\n'),
      'plugins/needs-task.js': createPluginModuleSource({
        emits_source: '{ task_checked: z.object({ ok: z.boolean() }) }',
        run_source: [
          "    await context.emit('task_checked', { ok: true });",
        ].join('\n'),
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query:
        '$class == $signal and kind == task_checked and subject == document',
      binding_targets: {
        document: {
          id: 'contract:parent-contract',
          path: 'docs/contracts/runtime/parent-contract.md',
          status: 'active',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/needs-task',
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
    expect(run_result.worker_error).toContain(
      'Expected plugin execution to have a bound task context.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails resumed plugin execution when the persisted run id is blank', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/log-and-emit.js': createPluginModuleSource({
        emits_source: '{ logged: z.object({ ok: z.boolean() }) }',
        run_source: ["    await context.emit('logged', { ok: true });"].join(
          '\n',
        ),
      }),
    }),
  });
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const worktree_path = join(
    temp_directory,
    '.pravaha/worktrees/implement-runtime-slice',
  );

  try {
    await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
    await mkdir(worktree_path, { recursive: true });
    await writeFile(
      runtime_record_path,
      `${JSON.stringify(
        {
          await_query:
            '$class == $signal and kind == logged and subject == task',
          binding_targets: {
            task: {
              id: 'task:implement-runtime-slice',
              path: 'docs/tasks/runtime/implement-runtime-slice.md',
              status: 'ready',
            },
          },
          contract_path: CONTRACT_PATH,
          execution: {
            next_step_index: 0,
            run_id: '   ',
          },
          flow_path: FLOW_PATH,
          lease: {
            leased_at: '2026-03-26T10:00:00.000Z',
          },
          local_outcome: {
            state: 'unresolved',
          },
          prompt: 'Persisted prompt.',
          selected_task: {
            id: 'implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
          },
          steps: [
            {
              kind: 'uses',
              step_name: 'local/log-and-emit',
            },
          ],
          transition_targets: {
            failure: 'blocked',
            success: 'review',
          },
          worker: {
            error_message: null,
            final_response: null,
            item_count: 0,
            thread_id: null,
            usage: null,
          },
          worktree: {
            identity: 'implement-runtime-slice',
            mode: 'named',
            path: worktree_path,
            slot: 'implement-runtime-slice',
          },
        },
        null,
        2,
      )}\n`,
    );

    const run_result = await resumeTaskAttempt(temp_directory, {
      durable_graph: {
        edges: [],
        nodes: {},
      },
      graph_api: {
        query_graph() {
          return {
            diagnostics: [],
            nodes: [],
          };
        },
      },
      now: () => new Date('2026-03-26T10:15:00.000Z'),
      relation_names: [],
      runtime_record: JSON.parse(await readFile(runtime_record_path, 'utf8')),
      runtime_record_path,
      worker_client: {
        startThread() {
          throw new Error('worker should not start when run id is invalid');
        },
      },
    });

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain(
      'Expected a stable run id for plugin execution.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
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
