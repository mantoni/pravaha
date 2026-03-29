/* eslint-disable jsdoc/prefer-import-tag */
import { rm } from 'node:fs/promises';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createBranchCommit,
  createQueueFixtureRepo,
  writeQueueValidationFlow,
} from './queue.test-support.js';

const {
  dispatchAssignmentAndWaitMock,
  resumeTaskAttemptMock,
  runStateMachineAttemptMock,
} = vi.hoisted(() => ({
  dispatchAssignmentAndWaitMock: vi.fn(),
  resumeTaskAttemptMock: vi.fn(),
  runStateMachineAttemptMock: vi.fn(),
}));

vi.mock(import('../runtime/dispatch/session.js'), () => ({
  dispatchAssignmentAndWait: dispatchAssignmentAndWaitMock,
}));

vi.mock(import('../runtime/attempts/state-machine.js'), () => ({
  resumeTaskAttempt: resumeTaskAttemptMock,
  runStateMachineAttempt: runStateMachineAttemptMock,
}));

afterEach(() => {
  vi.resetModules();
  dispatchAssignmentAndWaitMock.mockReset();
  resumeTaskAttemptMock.mockReset();
  runStateMachineAttemptMock.mockReset();
});

it('routes queue validation through the dispatch runtime instead of inline execution', async () => {
  vi.resetModules();

  installQueueValidationRuntimeMocks();
  const queue_module = await loadQueueModule();
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await createValidatedQueueCandidate(repo_directory);

    await expect(queue_module.syncQueue(repo_directory)).resolves.toMatchObject(
      {
        outcome: 'success',
        rejected_ready_refs: [],
        resumed_runs: [],
      },
    );
    assertQueueValidationDispatchCall(repo_directory);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @returns {void}
 */
function installQueueValidationRuntimeMocks() {
  dispatchAssignmentAndWaitMock.mockResolvedValue({
    dispatcher_id: 'worker-dispatcher',
    endpoint: '/tmp/dispatch.sock',
    outcome: 'success',
    worker_error: null,
    worker_id: 'worker-dispatcher',
  });
  resumeTaskAttemptMock.mockImplementation(rejectUnexpectedResumeTaskAttempt);
  runStateMachineAttemptMock.mockImplementation(
    rejectUnexpectedInlineStateMachineRun,
  );
}

/**
 * @returns {never}
 */
function rejectUnexpectedResumeTaskAttempt() {
  throw new Error('Did not expect queue validation to resume a runtime.');
}

/**
 * @returns {never}
 */
function rejectUnexpectedInlineStateMachineRun() {
  throw new Error(
    'Queue validation should use the dispatch runtime instead of inline execution.',
  );
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function createValidatedQueueCandidate(repo_directory) {
  const queue_module = await loadQueueModule();

  await writeQueueValidationFlow(repo_directory, 'test -f validated.txt');
  await createBranchCommit(
    repo_directory,
    'review/validated',
    'validated.txt',
    ['validated candidate'],
  );
  await queue_module.enqueueQueueHandoff(repo_directory, {
    branch_value: 'review/validated',
    run_id: 'run-validated',
  });
}

/**
 * @param {string} repo_directory
 * @returns {void}
 */
function assertQueueValidationDispatchCall(repo_directory) {
  expect(dispatchAssignmentAndWaitMock).toHaveBeenCalledTimes(1);
  expect(dispatchAssignmentAndWaitMock).toHaveBeenCalledWith(
    repo_directory,
    createExpectedQueueValidationAssignment(),
    expect.objectContaining({
      source: 'queue-sync',
    }),
  );
}

/**
 * @returns {Record<string, unknown>}
 */
function createExpectedQueueValidationAssignment() {
  return {
    assignment_id: 'queue-validation-0001-review-validated-run-validated',
    binding_targets: {
      document: {
        id: 'contract:queue-validation',
        path: '.pravaha/runtime/queue-validation/contract.md',
        status: 'active',
      },
      task: {
        id: 'task:queue-validation-0001-review-validated-run-validated',
        path: '.pravaha/runtime/queue-validation/queue-validation-0001-review-validated-run-validated.md',
        status: 'ready',
      },
    },
    contract_path: '.pravaha/runtime/queue-validation/contract.md',
    decision_paths: [],
    flow_instance_id: 'queue-validation-0001-review-validated-run-validated',
    flow_path: 'docs/flows/runtime/queue-validation.yaml',
    ordered_jobs: createExpectedQueueValidationJobs(),
    start_job_name: 'validate',
    task_id: 'queue-validation-0001-review-validated-run-validated',
    task_path:
      '.pravaha/runtime/queue-validation/queue-validation-0001-review-validated-run-validated.md',
    type: 'assignment',
    workspace: {
      materialize: {
        kind: 'worktree',
        mode: 'ephemeral',
        ref: 'refs/pravaha/queue-validation/current',
      },
      source: {
        id: 'app',
        kind: 'repo',
      },
      type: 'git.workspace',
    },
  };
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
function createExpectedQueueValidationJobs() {
  return [
    {
      job_name: 'validate',
      kind: 'action',
      limits: null,
      next_branches: [
        {
          condition_text: '${{ result.exit_code == 0 }}',
          target_job_name: 'done',
        },
        {
          condition_text: null,
          target_job_name: 'failed',
        },
      ],
      uses_value: 'core/run',
      with_value: {
        command: 'test -f validated.txt',
      },
    },
    {
      end_state: 'success',
      job_name: 'done',
      kind: 'end',
    },
    {
      end_state: 'failure',
      job_name: 'failed',
      kind: 'end',
    },
  ];
}

/**
 * @returns {Promise<typeof import('./queue.js')>}
 */
async function loadQueueModule() {
  return import('./queue.js');
}
