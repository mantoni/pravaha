import { readFile, rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../../plugin.fixture-test-helpers.js';
import { FLOW_PATH } from '../../reconcile.fixture-test-helpers.js';
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { runStateMachineAttempt } from './state-machine.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../runtime-attempt.state-machine-test-helpers.js';

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

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';

it('returns pending approval when a plugin requests approval', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  review:',
    '    uses: core/approval',
    '    with:',
    '      title: Review',
    '      message: Approve?',
    '      options: [approve]',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('pending-approval');
    expect(runtime_record.job_state.current_job_name).toBe('review');
    expect(runtime_record.approval?.approved_at).toBeNull();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns pending approval when a local plugin requests approval', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  review:',
        '    uses: local/request-approval',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/request-approval.js': createPluginModuleSource({
        run_source: [
          '    await context.requestApproval();',
          '    return { unreachable: true };',
        ].join('\n'),
      }),
    }),
  });

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('pending-approval');
    expect(runtime_record.approval).toEqual({
      approved_at: null,
      requested_at: expect.any(String),
    });
    expect(runtime_record.job_state.current_job_name).toBe('review');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('normalizes undefined local plugin results into empty objects', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/no-result',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/no-result.js': createPluginModuleSource({
        run_source: '    return undefined;',
      }),
    }),
  });

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.inspect).toEqual({});
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('captures stdout and stderr for core/run jobs when requested', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  test:',
    '    uses: core/run',
    '    with:',
    '      command: printf out && printf err >&2',
    '      capture: [stdout, stderr]',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.test).toEqual({
      exit_code: 0,
      stderr: 'err',
      stdout: 'out',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rethrows ordinary local plugin failures', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/throw-error',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/throw-error.js': createPluginModuleSource({
        run_source: "    throw new Error('plugin boom');",
      }),
    }),
  });

  try {
    await expect(executeStateMachineFlow(temp_directory)).rejects.toThrow(
      'plugin boom',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @param {{
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
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
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowSource(yaml_lines) {
  return [...yaml_lines, ''].join('\n');
}
