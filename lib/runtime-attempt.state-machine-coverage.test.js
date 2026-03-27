/* eslint-disable max-lines-per-function */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from './plugin.fixture-test-helpers.js';
import { createFixtureDocument } from './run-happy-path.fixture-test-helpers.js';
import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import { loadStateMachineFlow } from './reconcile-flow.js';
import {
  resumeTaskAttempt,
  runStateMachineAttempt,
} from './runtime-attempt.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from './runtime-attempt.state-machine-test-helpers.js';

/**
 * @typedef {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   job_state: {
 *     current_job_name?: string,
 *     job_outputs: Record<string, Record<string, unknown>>,
 *   },
 * }} StateMachineRuntimeRecord
 */

it('records agent failures as result data and follows failure branches', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement ${{ task.path }}.',
    '    next:',
    '      - if: ${{ result.outcome == "failure" }}',
    '        goto: done',
    '  done:',
    '    end: success',
  ]);

  try {
    const { runtime_record, run_result } = await executeStateMachineFlow(
      temp_directory,
      {
        worker_client: createFailingWorkerClient('worker boom'),
      },
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.implement).toEqual({
      error: 'worker boom',
      outcome: 'failure',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects unsupported core/agent providers', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: not-codex',
    '      prompt: Implement ${{ task.path }}.',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    await expect(executeStateMachineFlow(temp_directory)).rejects.toThrow(
      'Unsupported core/agent provider "not-codex".',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('normalizes non-object local plugin results and preserves document bindings', async () => {
  const temp_directory = await createPrimitivePluginFixtureRepo();

  try {
    const { runtime_record, run_result } = await executeStateMachineFlow(
      temp_directory,
      {
        binding_targets: {
          document: {
            id: 'contract:runtime-parent',
            path: 'docs/contracts/runtime/parent-contract.md',
            status: 'active',
          },
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
      },
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.inspect).toEqual({
      value: 'contract:runtime-parent',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('routes plugin console output to operator io on the state-machine surface', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFixtureDocument({
        body: [
          '# State Machine Flow',
          '',
          '```yaml',
          ...[
            ...createStateMachinePreamble(),
            '  inspect:',
            '    uses: local/log-output',
            '    next: done',
            '  done:',
            '    end: success',
          ],
          '```',
          '',
        ].join('\n'),
        metadata: /** @type {Array<[string, string]>} */ ([
          ['Kind', 'flow'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
        ]),
      }),
      'plugins/log-output.js': createPluginModuleSource({
        emits_source: '{}',
        run_source: [
          "    context.console.log('log', { mode: 'log' });",
          "    context.console.info('info', { mode: 'info' });",
          "    context.console.warn('warn', { mode: 'warn' });",
          "    context.console.error('error', { mode: 'error' });",
          '    return { ok: true };',
        ].join('\n'),
      }),
    }),
  });
  const io_context = createIoContext();

  try {
    const { run_result } = await executeStateMachineFlow(temp_directory, {
      operator_io: io_context,
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

it('fails resumed local plugin execution when the persisted run id is blank', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFixtureDocument({
        body: [
          '# State Machine Flow',
          '',
          '```yaml',
          ...[
            ...createStateMachinePreamble(),
            '  inspect:',
            '    uses: local/noop',
            '    next: done',
            '  done:',
            '    end: success',
          ],
          '```',
          '',
        ].join('\n'),
        metadata: /** @type {Array<[string, string]>} */ ([
          ['Kind', 'flow'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
        ]),
      }),
      'plugins/noop.js': createPluginModuleSource({
        emits_source: '{}',
        run_source: '    return { ok: true };',
      }),
    }),
  });
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
    await writeFile(
      runtime_record_path,
      `${JSON.stringify(
        {
          binding_targets: {
            task: {
              id: 'task:implement-runtime-slice',
              path: 'docs/tasks/runtime/implement-runtime-slice.md',
              status: 'ready',
            },
          },
          contract_path: CONTRACT_PATH,
          current_job_name: 'inspect',
          execution: {
            run_id: '   ',
          },
          flow_path: FLOW_PATH,
          format_version: 'state-machine-v2',
          job_state: {
            current_job_name: 'inspect',
            job_outputs: {},
            job_visit_counts: {
              inspect: 1,
            },
          },
          lease: {
            leased_at: '2026-03-27T10:00:00.000Z',
          },
          local_outcome: {
            state: 'unresolved',
          },
          prompt: 'Persisted prompt.',
          selected_task: {
            id: 'implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
          },
          worker: {
            error_message: null,
            final_response: null,
            item_count: 0,
            thread_id: null,
            usage: null,
          },
          worktree: {
            identity: 'pooled-app-main',
            mode: 'pooled',
            path: join(temp_directory, '.pravaha/worktrees/pooled-app-main'),
          },
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      resumeTaskAttempt(temp_directory, {
        runtime_record: JSON.parse(await readFile(runtime_record_path, 'utf8')),
        runtime_record_path,
        worker_client: {
          startThread() {
            throw new Error('worker should not start when run id is invalid');
          },
        },
      }),
    ).rejects.toThrow('Expected a stable run id for plugin execution.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails plugin execution when the task binding is missing', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'docs/contracts/runtime/parent-contract.md': [
        '---',
        'Kind: contract',
        'Id: runtime-parent',
        'Status: active',
        '---',
        '# Parent Contract',
        '',
      ].join('\n'),
      [FLOW_PATH]: createFixtureDocument({
        body: [
          '# State Machine Flow',
          '',
          '```yaml',
          ...[
            ...createStateMachinePreamble(),
            '  inspect:',
            '    uses: local/read-task',
            '    next: done',
            '  done:',
            '    end: success',
          ],
          '```',
          '',
        ].join('\n'),
        metadata: /** @type {Array<[string, string]>} */ ([
          ['Kind', 'flow'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
        ]),
      }),
      'plugins/read-task.js': createPluginModuleSource({
        emits_source: '{}',
        run_source: '    return { task_id: context.task.id };',
      }),
    }),
  });

  try {
    await expect(
      executeStateMachineFlow(temp_directory, {
        binding_targets: {
          document: {
            id: 'contract:runtime-parent',
            path: 'docs/contracts/runtime/parent-contract.md',
            status: 'active',
          },
        },
      }),
    ).rejects.toThrow(
      'Expected plugin execution to have a bound task context.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @returns {Promise<string>}
 */
async function createPrimitivePluginFixtureRepo() {
  return createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'docs/contracts/runtime/parent-contract.md': [
        '---',
        'Kind: contract',
        'Id: runtime-parent',
        'Status: active',
        '---',
        '# Parent Contract',
        '',
      ].join('\n'),
      [FLOW_PATH]: createFixtureDocument({
        body: [
          '# State Machine Flow',
          '',
          '```yaml',
          ...[
            ...createStateMachinePreamble(),
            '  inspect:',
            '    uses: local/inspect-document',
            '    next: done',
            '  done:',
            '    end: success',
          ],
          '```',
          '',
        ].join('\n'),
        metadata: /** @type {Array<[string, string]>} */ ([
          ['Kind', 'flow'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
        ]),
      }),
      'plugins/inspect-document.js': createPluginModuleSource({
        emits_source: '{}',
        run_source: '    return context.document.id;',
      }),
    }),
  });
}

/**
 * @param {string} temp_directory
 * @param {{
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   worker_client?: unknown,
 * }} [overrides]
 * @returns {Promise<{
 *   run_result: Awaited<ReturnType<typeof runStateMachineAttempt>>,
 *   runtime_record: StateMachineRuntimeRecord,
 * }>}
 */
async function executeStateMachineFlow(temp_directory, overrides = {}) {
  const flow = await loadStateMachineFlow(temp_directory, FLOW_PATH);
  const run_result = await runStateMachineAttempt(temp_directory, {
    binding_targets: overrides.binding_targets,
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    operator_io: overrides.operator_io,
    ordered_jobs: flow.ordered_jobs,
    runtime_label: 'State-machine runtime slice',
    start_job_name: flow.start_job_name,
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    worker_client: /** @type {any} */ (overrides.worker_client),
    workspace: flow.workspace,
  });
  const runtime_record = /** @type {StateMachineRuntimeRecord} */ (
    JSON.parse(await readFile(run_result.runtime_record_path, 'utf8'))
  );

  return {
    run_result,
    runtime_record,
  };
}

/**
 * @param {string} error_message
 * @returns {unknown}
 */
function createFailingWorkerClient(error_message) {
  return {
    startThread() {
      return {
        id: 'thread-agent',
        async run() {
          throw new Error(error_message);
        },
      };
    },
  };
}

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
