import { readFile, rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../../../test/fixtures/plugin-fixture.js';
import {
  CONTRACT_PATH,
  FLOW_PATH,
} from '../../../test/fixtures/reconcile-fixture.js';
import { installFakeCodexExecutable } from '../../../test/support/runtime.js';
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { runStateMachineAttempt } from './state-machine.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../../test/support/runtime-attempt-state-machine.js';

/**
 * @typedef {{
 *   job_state: {
 *     current_job_name: string,
 *     job_outputs: Record<string, Record<string, unknown>>,
 *     job_visit_counts: Record<string, number>,
 *   },
 *   local_outcome: {
 *     state: string,
 *   },
 *   worker: {
 *     error?: string | null,
 *     worker_error?: string | null,
 *   },
 * }} StateMachineRuntimeRecord
 */

it('runs a successful core/run-codex job and records rendered outputs', async () => {
  await verifyCoreRunCodexRun();
});

it('captures core/run results, git status, and flow dispatch handoff outputs', async () => {
  await verifyCoreRunGitStatusAndDispatch();
});

it('returns pending approval for core/approval and leaves the job unresolved', async () => {
  await verifyApprovalRun();
});

it('fails when no next branch matches and when a loop exceeds max-visits', async () => {
  await verifyNextBranchFailureAndLoopLimit();
});

it('keeps local plugin execution working on the state-machine surface', async () => {
  await verifyLocalPluginRun();
});

/**
 * @returns {string[]}
 */
function createStateMachineYamlLines() {
  return [
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Implement ${{ task.path }}.',
    '      reasoning: medium',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createCoreRunDispatchYamlLines() {
  return [
    ...createStateMachinePreamble(),
    '  write_file:',
    '    uses: core/run',
    '    with:',
    '      command: printf changed > scratch.txt',
    '    next: git_status',
    '  git_status:',
    '    uses: core/git-status',
    '    next:',
    '      - if: ${{ result.dirty == true }}',
    '        goto: handoff',
    '      - goto: done',
    '  handoff:',
    '    uses: core/flow-dispatch',
    '    with:',
    '      flow: integration',
    '      inputs:',
    '        task_path: ${{ task.path }}',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createNoMatchYamlLines() {
  return [
    ...createStateMachinePreamble(),
    '  test:',
    '    uses: core/run',
    '    with:',
    '      command: exit 1',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createLoopLimitYamlLines() {
  return [
    ...createStateMachinePreamble(),
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: exit 1',
    '    limits:',
    '      max-visits: 2',
    '    next: retry',
  ];
}

/**
 * @returns {Promise<string>}
 */
async function createLocalPluginFixtureRepo() {
  return createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      [FLOW_PATH]: createFlowSource([
        ...createStateMachinePreamble(),
        '  inspect:',
        '    uses: local/inspect-task',
        '    with:',
        '      label: ${{ task.path }}',
        '    next: done',
        '  done:',
        '    end: success',
      ]),
      'plugins/inspect-task.js': createPluginModuleSource({
        run_source:
          '    return { label: context.with.label, task_id: context.task.id };',
        with_source: 'z.object({ label: z.string() })',
      }),
    }),
  });
}

/**
 * @returns {Promise<void>}
 */
async function verifyCoreRunCodexRun() {
  const temp_directory = await createStateMachineFixtureRepo(
    createStateMachineYamlLines(),
  );

  try {
    const { runtime_record, run_result } = await executeStateMachineFlow(
      temp_directory,
      {
        codex_expect_prompt:
          'Implement docs/tasks/runtime/implement-runtime-slice.md.',
        codex_last_message: 'completed',
      },
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state).toMatchObject({
      current_job_name: 'done',
      job_outputs: {
        implement: {
          exit_code: 0,
          outcome: 'success',
          reasoning: 'medium',
          summary: 'completed',
        },
      },
      job_visit_counts: {
        implement: 1,
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
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
 * @returns {Promise<void>}
 */
async function verifyCoreRunGitStatusAndDispatch() {
  const temp_directory = await createStateMachineFixtureRepo(
    createCoreRunDispatchYamlLines(),
  );

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.write_file).toMatchObject({
      exit_code: 0,
    });
    expect(runtime_record.job_state.job_outputs.git_status).toMatchObject({
      dirty: true,
      head: asMatcher(expect.any(String)),
    });
    expect(runtime_record.job_state.job_outputs.handoff).toEqual({
      dispatched: true,
      flow: 'integration',
      inputs: {
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
      wait: false,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @returns {Promise<void>}
 */
async function verifyApprovalRun() {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  review:',
    '    uses: core/approval',
    '    with:',
    '      title: Review',
    '      message: Approve or reject.',
    '      options: [approve, reject]',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    let stdout_text = '';
    const { runtime_record, run_result } = await executeStateMachineFlow(
      temp_directory,
      {
        operator_io: {
          stderr: {
            write() {
              return true;
            },
          },
          stdout: {
            write(chunk) {
              stdout_text += chunk;
              return true;
            },
          },
        },
      },
    );

    expect(run_result.outcome).toBe('pending-approval');
    expect(stdout_text).toContain('Approval requested.');
    expect(runtime_record.local_outcome.state).toBe('unresolved');
    expect(runtime_record.job_state.current_job_name).toBe('review');
    expect(runtime_record.job_state.job_visit_counts).toEqual({
      review: 1,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @returns {Promise<void>}
 */
async function verifyNextBranchFailureAndLoopLimit() {
  const no_match_directory = await createStateMachineFixtureRepo(
    createNoMatchYamlLines(),
  );
  const loop_directory = await createStateMachineFixtureRepo(
    createLoopLimitYamlLines(),
  );

  try {
    const no_match_execution =
      await executeStateMachineFlow(no_match_directory);
    const loop_execution = await executeStateMachineFlow(loop_directory);

    expect(no_match_execution.run_result.outcome).toBe('failure');
    expect(no_match_execution.runtime_record).not.toHaveProperty('worker');
    expect(no_match_execution.run_result.worker_error).toContain(
      'did not match any next branch',
    );
    expect(loop_execution.run_result.outcome).toBe('failure');
    expect(loop_execution.run_result.worker_error).toContain(
      'exceeded max-visits',
    );
    expect(loop_execution.runtime_record.job_state.job_visit_counts).toEqual({
      retry: 3,
    });
  } finally {
    await rm(no_match_directory, { force: true, recursive: true });
    await rm(loop_directory, { force: true, recursive: true });
  }
}

/**
 * @returns {Promise<void>}
 */
async function verifyLocalPluginRun() {
  const temp_directory = await createLocalPluginFixtureRepo();

  try {
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.job_state.job_outputs.inspect).toEqual({
      label: 'docs/tasks/runtime/implement-runtime-slice.md',
      task_id: 'task:implement-runtime-slice',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @param {string} temp_directory
 * @param {{
 *   codex_expect_prompt?: string,
 *   codex_exit_code?: string,
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
  const environment_snapshot = captureCodexEnvironment();
  await applyCodexEnvironment(temp_directory, overrides);
  const flow = await loadStateMachineFlow(temp_directory, FLOW_PATH);
  try {
    const run_result = await runStateMachineAttempt(temp_directory, {
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
    const runtime_record = parseStateMachineRuntimeRecord(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    return {
      run_result,
      runtime_record,
    };
  } finally {
    restoreCodexEnvironment(environment_snapshot);
  }
}

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}

/**
 * @param {string} runtime_record_text
 * @returns {StateMachineRuntimeRecord}
 */
function parseStateMachineRuntimeRecord(runtime_record_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(runtime_record_text));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected runtime record JSON to evaluate to an object.');
  }

  return /** @type {StateMachineRuntimeRecord} */ (parsed_value);
}

/**
 * @returns {Record<string, string | undefined>}
 */
function captureCodexEnvironment() {
  return {
    PRAVAHA_CODEX_BIN: process.env.PRAVAHA_CODEX_BIN,
    PRAVAHA_TEST_CODEX_EXPECT_PROMPT:
      process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT,
    PRAVAHA_TEST_CODEX_EXIT_CODE: process.env.PRAVAHA_TEST_CODEX_EXIT_CODE,
    PRAVAHA_TEST_CODEX_LAST_MESSAGE:
      process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE,
    PRAVAHA_TEST_CODEX_STDERR: process.env.PRAVAHA_TEST_CODEX_STDERR,
    PRAVAHA_TEST_CODEX_STDOUT: process.env.PRAVAHA_TEST_CODEX_STDOUT,
  };
}

/**
 * @param {string} temp_directory
 * @param {{
 *   codex_expect_prompt?: string,
 *   codex_exit_code?: string,
 *   codex_last_message?: string,
 *   codex_stderr?: string,
 *   codex_stdout?: string,
 * }} overrides
 * @returns {Promise<void>}
 */
async function applyCodexEnvironment(temp_directory, overrides) {
  process.env.PRAVAHA_CODEX_BIN =
    await installFakeCodexExecutable(temp_directory);
  process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT =
    overrides.codex_expect_prompt ?? '';
  process.env.PRAVAHA_TEST_CODEX_EXIT_CODE = overrides.codex_exit_code ?? '';
  process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE =
    overrides.codex_last_message ?? '';
  process.env.PRAVAHA_TEST_CODEX_STDERR = overrides.codex_stderr ?? '';
  process.env.PRAVAHA_TEST_CODEX_STDOUT = overrides.codex_stdout ?? '';
}

/**
 * @param {Record<string, string | undefined>} environment_snapshot
 * @returns {void}
 */
function restoreCodexEnvironment(environment_snapshot) {
  for (const [name, value] of Object.entries(environment_snapshot)) {
    restoreEnvironmentVariable(name, value);
  }
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
