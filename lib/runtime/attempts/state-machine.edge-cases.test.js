import { readFile, rm, writeFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../../../test/fixtures/plugin-fixture.js';
import { FLOW_PATH } from '../../../test/fixtures/reconcile-fixture.js';
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { execGitFile } from '../../shared/git/exec-git-file.js';
import { runStateMachineAttempt } from './state-machine.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../../test/support/runtime-attempt-state-machine.js';

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
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
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
      requested_at: asMatcher(expect.any(String)),
    });
    expect(runtime_record.job_state.current_job_name).toBe('review');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns pending queue when core/queue-handoff enqueues a branch ref', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  queue_review:',
    '    uses: core/queue-handoff',
    '    with:',
    '      branch: review/task-1',
    '    next: done',
    '  done:',
    '    end: success',
  ]);

  try {
    await createBranchCommit(temp_directory, 'review/task-1', 'review.txt');

    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('pending-queue');
    expect(runtime_record.approval).toBeUndefined();
    expect(runtime_record.job_state.current_job_name).toBe('queue_review');
    expect(runtime_record.queue_wait).toMatchObject({
      branch_ref: 'refs/heads/review/task-1',
      outcome: null,
      state: 'waiting',
    });
    await expect(
      readRevisionFromGitDirectory(
        `${temp_directory}/.pravaha/queue.git`,
        runtime_record.queue_wait?.ready_ref ?? '',
      ),
    ).resolves.toBe(runtime_record.queue_wait?.branch_head);
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

it('records ordinary local plugin failures as terminal runtime failures', async () => {
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
    const { runtime_record, run_result } =
      await executeStateMachineFlow(temp_directory);

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toBe('plugin boom');
    expect(runtime_record.job_state.current_job_name).toBe('inspect');
    expect(readLocalOutcomeState(runtime_record)).toBe('failure');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @param {{
 *   binding_targets?: {
 *     doc?: { id: string, path: string, status: string },
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
  const runtime_record = parseStateMachineRuntimeRecord(
    await readFile(run_result.runtime_record_path, 'utf8'),
  );

  return {
    run_result,
    runtime_record,
  };
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
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowSource(yaml_lines) {
  return [...yaml_lines, ''].join('\n');
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @returns {Promise<void>}
 */
async function createBranchCommit(repo_directory, branch_name, file_name) {
  await execGitFile(['checkout', '-b', branch_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await writeFile(`${repo_directory}/${file_name}`, `${branch_name}\n`);
  await execGitFile(['add', file_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', `Create ${branch_name}`], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['checkout', 'main'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} git_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevisionFromGitDirectory(git_directory, revision) {
  const { stdout } = await execGitFile(
    ['--git-dir', git_directory, 'rev-parse', revision],
    {
      cwd: git_directory,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}

/**
 * @param {StateMachineRuntimeRecord & Record<string, unknown>} runtime_record
 * @returns {string | undefined}
 */
function readLocalOutcomeState(runtime_record) {
  const local_outcome = runtime_record.local_outcome;

  if (
    local_outcome === null ||
    typeof local_outcome !== 'object' ||
    Array.isArray(local_outcome)
  ) {
    return undefined;
  }

  const local_outcome_record = /** @type {Record<string, unknown>} */ (
    local_outcome
  );
  const state = local_outcome_record.state;

  return typeof state === 'string' ? state : undefined;
}
