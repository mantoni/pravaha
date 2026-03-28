/* eslint-disable max-lines-per-function */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../../plugin.fixture-test-helpers.js';
import {
  CONTRACT_PATH,
  FLOW_PATH,
} from '../../reconcile.fixture-test-helpers.js';
import { installFakeCodexExecutable } from '../../runtime-test-helpers.js';
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { resumeTaskAttempt, runStateMachineAttempt } from './state-machine.js';
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

it('records run-codex failures as result data and follows failure branches', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Implement ${{ task.path }}.',
    '      reasoning: medium',
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
        codex_exit_code: '1',
        codex_stderr: 'worker boom',
      },
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.implement).toEqual({
      exit_code: 1,
      error: 'worker boom',
      outcome: 'failure',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects invalid core/run-codex reasoning values', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Implement ${{ task.path }}.',
    '      reasoning: maximal',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    await expect(executeStateMachineFlow(temp_directory)).rejects.toThrow(
      'Invalid option',
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
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/log-output',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/log-output.js': createPluginModuleSource({
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
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/noop',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/noop.js': createPluginModuleSource({
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
          local_outcome: {
            state: 'unresolved',
          },
          selected_task: {
            id: 'implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
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
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/read-task',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/read-task.js': createPluginModuleSource({
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
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/inspect-document',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/inspect-document.js': createPluginModuleSource({
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
 *   codex_exit_code?: string,
 *   codex_expect_prompt?: string,
 *   codex_last_message?: string,
 *   codex_stderr?: string,
 *   codex_stdout?: string,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 * }} [overrides]
 * @returns {Promise<{
 *   run_result: Awaited<ReturnType<typeof runStateMachineAttempt>>,
 *   runtime_record: StateMachineRuntimeRecord,
 * }>}
 */
async function executeStateMachineFlow(temp_directory, overrides = {}) {
  const previous_codex_bin = process.env.PRAVAHA_CODEX_BIN;
  const previous_codex_expect_prompt =
    process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT;
  const previous_codex_exit_code = process.env.PRAVAHA_TEST_CODEX_EXIT_CODE;
  const previous_codex_last_message =
    process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE;
  const previous_codex_stderr = process.env.PRAVAHA_TEST_CODEX_STDERR;
  const previous_codex_stdout = process.env.PRAVAHA_TEST_CODEX_STDOUT;
  process.env.PRAVAHA_CODEX_BIN =
    await installFakeCodexExecutable(temp_directory);
  process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT =
    overrides.codex_expect_prompt ?? '';
  process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = overrides.codex_exit_code ?? '';
  process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE =
    overrides.codex_last_message ?? '';
  process.env.PRAVAHA_TEST_CODEX_STDERR = overrides.codex_stderr ?? '';
  process.env.PRAVAHA_TEST_CODEX_STDOUT = overrides.codex_stdout ?? '';
  const flow = await loadStateMachineFlow(temp_directory, FLOW_PATH);
  try {
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
      workspace: flow.workspace,
    });
    const runtime_record = /** @type {StateMachineRuntimeRecord} */ (
      JSON.parse(await readFile(run_result.runtime_record_path, 'utf8'))
    );

    return {
      run_result,
      runtime_record,
    };
  } finally {
    restoreEnvironmentVariable('PRAVAHA_CODEX_BIN', previous_codex_bin);
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_EXPECT_PROMPT',
      previous_codex_expect_prompt,
    );
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_EXIT_CODE',
      previous_codex_exit_code,
    );
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_LAST_MESSAGE',
      previous_codex_last_message,
    );
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_STDERR',
      previous_codex_stderr,
    );
    restoreEnvironmentVariable(
      'PRAVAHA_TEST_CODEX_STDOUT',
      previous_codex_stdout,
    );
  }
}

/**
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowSource(yaml_lines) {
  return [...yaml_lines, ''].join('\n');
}

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {void}
 */
function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
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
