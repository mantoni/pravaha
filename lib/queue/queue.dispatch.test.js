/* eslint-disable jsdoc/prefer-import-tag */
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createBranchCommit,
  createQueueFixtureRepo,
  writeQueueValidationFlow,
} from './queue.test-support.js';
import { enqueueQueueHandoff } from './queue-handoff.js';

const {
  dispatchAssignmentAndWaitMock,
  resumeJavaScriptFlowAttemptMock,
  runJavaScriptFlowAttemptMock,
} = vi.hoisted(() => ({
  dispatchAssignmentAndWaitMock: vi.fn(),
  resumeJavaScriptFlowAttemptMock: vi.fn(),
  runJavaScriptFlowAttemptMock: vi.fn(),
}));

vi.mock(import('../runtime/dispatch/session.js'), () => ({
  dispatchAssignmentAndWait: dispatchAssignmentAndWaitMock,
}));

vi.mock(import('../runtime/attempts/javascript-flow.js'), () => ({
  resumeJavaScriptFlowAttempt: resumeJavaScriptFlowAttemptMock,
  runJavaScriptFlowAttempt: runJavaScriptFlowAttemptMock,
}));

afterEach(() => {
  vi.resetModules();
  dispatchAssignmentAndWaitMock.mockReset();
  resumeJavaScriptFlowAttemptMock.mockReset();
  runJavaScriptFlowAttemptMock.mockReset();
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

// eslint-disable-next-line max-lines-per-function
it('builds pooled queue-validation assignments from the configured namespace', async () => {
  vi.resetModules();

  installQueueValidationRuntimeMocks();
  const queue_module = await loadQueueModule();
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await writeFile(
      join(repo_directory, 'pravaha.json'),
      `${JSON.stringify(
        {
          flows: ['docs/flows/runtime/single-task-flow-reconciler.js'],
          workspaces: {
            app: {
              base_path: '.pravaha/worktrees/app',
              mode: 'ephemeral',
              ref: 'main',
              source: {
                kind: 'repo',
              },
            },
            'queue-validation': {
              mode: 'pooled',
              paths: ['.pravaha/worktrees/queue-validation-slot'],
              ref: 'refs/pravaha/queue-validation/current',
              source: {
                kind: 'repo',
              },
            },
          },
          queue: {
            validation_flow: 'docs/flows/runtime/queue-validation.js',
          },
        },
        null,
        2,
      )}\n`,
    );
    await createValidatedQueueCandidate(repo_directory);

    await expect(queue_module.syncQueue(repo_directory)).resolves.toMatchObject(
      {
        outcome: 'success',
      },
    );
    expect(dispatchAssignmentAndWaitMock).toHaveBeenCalledWith(
      repo_directory,
      expect.objectContaining({
        workspace: {
          id: 'queue-validation',
          location: {
            path: `${repo_directory}/.pravaha/worktrees/queue-validation-slot`,
          },
          mode: 'pooled',
          ref: 'refs/pravaha/queue-validation/current',
          source: {
            kind: 'repo',
          },
        },
      }),
      expect.any(Object),
    );
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
  resumeJavaScriptFlowAttemptMock.mockImplementation(
    rejectUnexpectedResumeJavaScriptFlowAttempt,
  );
  runJavaScriptFlowAttemptMock.mockImplementation(
    rejectUnexpectedInlineJavaScriptFlowRun,
  );
}

/**
 * @returns {never}
 */
function rejectUnexpectedResumeJavaScriptFlowAttempt() {
  throw new Error('Did not expect queue validation to resume a runtime.');
}

/**
 * @returns {never}
 */
function rejectUnexpectedInlineJavaScriptFlowRun() {
  throw new Error(
    'Queue validation should use the dispatch runtime instead of inline execution.',
  );
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function createValidatedQueueCandidate(repo_directory) {
  await writeQueueValidationFlow(repo_directory, 'test -f validated.txt');
  await createBranchCommit(
    repo_directory,
    'review/validated',
    'validated.txt',
    ['validated candidate'],
  );
  await enqueueQueueHandoff(repo_directory, {
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
    createExpectedQueueValidationAssignment(repo_directory),
    {
      operator_io: undefined,
      source: 'queue-sync',
    },
  );
}

/**
 * @param {string} repo_directory
 * @returns {Record<string, unknown>}
 */
function createExpectedQueueValidationAssignment(repo_directory) {
  return {
    assignment_id: 'queue-validation-0001-review-validated-run-validated',
    binding_targets: {
      doc: {
        id: 'task:queue-validation-0001-review-validated-run-validated',
        path: '.pravaha/runtime/queue-validation/queue-validation-0001-review-validated-run-validated.md',
        status: 'ready',
      },
    },
    contract_path: '.pravaha/runtime/queue-validation/contract.md',
    decision_paths: [],
    flow_instance_id: 'queue-validation-0001-review-validated-run-validated',
    flow_path: 'docs/flows/runtime/queue-validation.js',
    task_id: 'queue-validation-0001-review-validated-run-validated',
    task_path:
      '.pravaha/runtime/queue-validation/queue-validation-0001-review-validated-run-validated.md',
    type: 'assignment',
    workspace: {
      id: 'queue-validation',
      location: {
        path:
          `${repo_directory}/.pravaha/worktrees/queue-validation/` +
          'queue-validation-0001-review-validated-run-validated',
      },
      mode: 'ephemeral',
      ref: 'refs/pravaha/queue-validation/current',
      source: {
        kind: 'repo',
      },
    },
  };
}

/**
 * @returns {Promise<typeof import('./queue.js')>}
 */
async function loadQueueModule() {
  return import('./queue.js');
}
