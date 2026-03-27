import { readFile, rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from './plugin.fixture-test-helpers.js';
import { createFixtureDocument } from './run-happy-path.fixture-test-helpers.js';
import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import { loadStateMachineFlow } from './reconcile-flow.js';
import { runStateMachineAttempt } from './runtime-attempt.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from './runtime-attempt.state-machine-test-helpers.js';

/**
 * @typedef {{
 *   job_state: {
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
