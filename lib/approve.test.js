import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { approve } from './approve.js';
import {
  CONTRACT_PATH,
  FLOW_PATH,
} from '../test/fixtures/reconcile-fixture.js';
import { loadStateMachineFlow } from './flow/reconcile-flow.js';
import { loadSingleUnresolvedRuntimeRecordByToken } from './runtime/records/runtime-records.js';
import { runStateMachineAttempt } from './runtime/attempts/state-machine.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../test/support/runtime-attempt-state-machine.js';

it('loads the unresolved runtime record that matches the approval token', async () => {
  const repo_directory = await mkdtemp(join(tmpdir(), 'pravaha-approve-'));
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const matching_runtime_record_path = join(runtime_directory, 'match.json');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'other.json'),
      createApprovalRecordFixture({
        run_id: 'run:other:2026-03-26T09:00:00.000Z',
        task_id: 'other-task',
      }),
    );
    await writeRuntimeRecord(
      matching_runtime_record_path,
      createApprovalRecordFixture({
        run_id: 'run:match:2026-03-26T10:00:00.000Z',
        task_id: 'match-task',
      }),
    );

    await expect(
      loadSingleUnresolvedRuntimeRecordByToken(
        repo_directory,
        'run:match:2026-03-26T10:00:00.000Z',
      ),
    ).resolves.toEqual({
      record: createApprovalRecordFixture({
        run_id: 'run:match:2026-03-26T10:00:00.000Z',
        task_id: 'match-task',
      }),
      runtime_record_path: matching_runtime_record_path,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects unknown approval tokens and runs that are not waiting for approval', async () => {
  const repo_directory = await mkdtemp(join(tmpdir(), 'pravaha-approve-'));
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'approved.json'),
      createApprovalRecordFixture({
        approved_at: '2026-03-26T10:15:00.000Z',
        run_id: 'run:approved:2026-03-26T10:00:00.000Z',
        task_id: 'approved-task',
      }),
    );

    await expect(
      loadSingleUnresolvedRuntimeRecordByToken(
        repo_directory,
        'run:missing:2026-03-26T10:00:00.000Z',
      ),
    ).rejects.toThrow(
      'No unresolved runtime record is waiting for approval token "run:missing:2026-03-26T10:00:00.000Z".',
    );
    await expect(
      loadSingleUnresolvedRuntimeRecordByToken(
        repo_directory,
        'run:approved:2026-03-26T10:00:00.000Z',
      ),
    ).rejects.toThrow(
      'No unresolved runtime record is waiting for approval token "run:approved:2026-03-26T10:00:00.000Z".',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects blank approval tokens before any runtime lookup', async () => {
  await expect(
    approve('/repo', {
      token: '   ',
    }),
  ).rejects.toThrow('Expected approve to receive a non-empty approval token.');
});

it('approves and resumes a pending state-machine runtime record', async () => {
  const repo_directory = await createApprovalStateMachineFixtureRepo();

  try {
    const initial_result = await startApprovalRun(repo_directory);

    const pending_runtime_record = parsePendingRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );

    const approve_result = await approve(repo_directory, {
      now: () => new Date('2026-03-25T09:05:00.000Z'),
      token: pending_runtime_record.execution.run_id,
    });

    expect(initial_result.outcome).toBe('pending-approval');
    expect(approve_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('uses the default current date when no now override is provided', async () => {
  const repo_directory = await createApprovalStateMachineFixtureRepo();

  try {
    const initial_result = await startApprovalRun(repo_directory);

    const pending_runtime_record = parsePendingRuntimeRecord(
      await readFile(initial_result.runtime_record_path, 'utf8'),
    );
    const approve_result = await approve(repo_directory, {
      token: pending_runtime_record.execution.run_id,
    });

    expect(approve_result.outcome).toBe('success');
    expect(approve_result.worker_error).toBeNull();
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   approved_at?: string | null,
 *   run_id: string,
 *   task_id: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createApprovalRecordFixture(options) {
  return {
    approval: {
      approved_at: options.approved_at ?? null,
      requested_at: '2026-03-26T10:05:00.000Z',
    },
    contract_path:
      'docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md',
    format_version: 'state-machine-v2',
    execution: {
      run_id: options.run_id,
    },
    flow_path:
      'docs/flows/runtime/minimal-plugin-context-and-approval-ingress.yaml',
    job_state: {
      current_job_name: 'review',
      job_outputs: {},
      job_visit_counts: {
        review: 1,
      },
    },
    local_outcome: {
      state: 'unresolved',
    },
    selected_task: {
      id: options.task_id,
      path: `docs/tasks/runtime/${options.task_id}.md`,
    },
  };
}

/**
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecord(runtime_record_path, runtime_record) {
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}

/**
 * @returns {Promise<string>}
 */
async function createApprovalStateMachineFixtureRepo() {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  review:',
    '    uses: core/approval',
    '    with:',
    '      title: Review runtime slice',
    '      message: Approve this runtime slice.',
    '      options: [approve]',
    '    next:',
    '      - if: ${{ result.verdict == "approve" }}',
    '        goto: done',
    '',
    '  done:',
    '    end: success',
  ]);
}

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function startApprovalRun(repo_directory) {
  const state_machine_flow = await loadStateMachineFlow(
    repo_directory,
    FLOW_PATH,
  );
  const initial_result = await runStateMachineAttempt(repo_directory, {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    now: () => new Date('2026-03-25T09:00:00.000Z'),
    ordered_jobs: state_machine_flow.ordered_jobs,
    runtime_label: 'Approval test runtime',
    start_job_name: state_machine_flow.start_job_name,
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    workspace: state_machine_flow.workspace,
  });

  if (initial_result.outcome !== 'pending-approval') {
    throw new Error('Expected the initial run to pause for approval.');
  }

  return initial_result;
}

/**
 * @param {string} runtime_record_text
 * @returns {{ execution: { run_id: string } }}
 */
function parsePendingRuntimeRecord(runtime_record_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(runtime_record_text));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected runtime record execution.run_id to be present.');
  }

  /** @type {{ execution?: unknown }} */
  const runtime_record = parsed_value;
  const { execution } = runtime_record;

  if (
    execution === null ||
    typeof execution !== 'object' ||
    Array.isArray(execution)
  ) {
    throw new Error('Expected runtime record execution.run_id to be present.');
  }

  /** @type {{ run_id?: unknown }} */
  const execution_record = execution;

  if (typeof execution_record.run_id !== 'string') {
    throw new Error('Expected runtime record execution.run_id to be present.');
  }

  return {
    execution: {
      run_id: execution_record.run_id,
    },
  };
}
