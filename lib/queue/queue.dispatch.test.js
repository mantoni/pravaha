/** @import * as $k$$l$queue$k$js from './queue.js'; */
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { execGitFile } from '../shared/git/exec-git-file.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../../test/support/runtime-attempt-state-machine.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

it('routes queue validation through the dispatch runtime instead of inline execution', async () => {
  const dispatchAssignmentAndWait = vi.fn(() =>
    Promise.resolve({
      dispatcher_id: 'worker-dispatcher',
      endpoint: '/tmp/dispatch.sock',
      outcome: 'success',
      worker_error: null,
      worker_id: 'worker-dispatcher',
    }),
  );

  installQueueValidationRuntimeMocks(dispatchAssignmentAndWait);
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
    assertQueueValidationDispatchCall(
      dispatchAssignmentAndWait,
      repo_directory,
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('reports Error upstream remote inspection failures when git stderr is empty', async () => {
  vi.doMock('../config/load-pravaha-config.js', () => ({
    loadPravahaConfig() {
      return Promise.resolve({
        config: {
          queue_config: {
            base_ref: 'refs/queue/meta/base',
            candidate_ref: 'refs/queue/candidate/current',
            dir: '.pravaha/queue.git',
            ready_ref_prefix: 'refs/queue/ready',
            target_branch: 'main',
            upstream_remote: 'origin',
            validation_flow: null,
          },
        },
        diagnostics: [],
      });
    },
  }));
  vi.doMock('../shared/git/exec-git-file.js', () => ({
    /**
     * @param {string[]} command_arguments
     * @returns {Promise<never>}
     */
    execGitFile(command_arguments) {
      if (
        command_arguments[0] === 'remote' &&
        command_arguments[1] === 'get-url'
      ) {
        return Promise.reject(new Error('remote inspection failed'));
      }

      throw new Error(
        `Unexpected git call ${JSON.stringify(command_arguments)}.`,
      );
    },
  }));

  const queue_module = await loadQueueModule();

  await expect(queue_module.initQueue('/repo')).rejects.toThrow(
    'Failed to inspect upstream remote "origin". remote inspection failed',
  );
});

/**
 * @param {{
 *   branch_step_lines: string[],
 * }} options
 * @returns {Promise<string>}
 */
async function createQueueFixtureRepo(options) {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    ...options.branch_step_lines,
  ]);
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function createBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
) {
  await execGitFile(['checkout', '-b', branch_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await writeFile(
    join(repo_directory, file_name),
    `${file_lines.join('\n')}\n`,
    'utf8',
  );
  await execGitFile(['add', file_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', `Update ${branch_name}`], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['checkout', 'main'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {ReturnType<typeof vi.fn>} dispatchAssignmentAndWait
 * @returns {void}
 */
function installQueueValidationRuntimeMocks(dispatchAssignmentAndWait) {
  vi.doMock('../runtime/dispatch/session.js', () => ({
    dispatchAssignmentAndWait,
  }));
  vi.doMock('../runtime/attempts/state-machine.js', () => ({
    resumeTaskAttempt() {
      throw new Error('Did not expect queue validation to resume a runtime.');
    },
    runStateMachineAttempt() {
      throw new Error(
        'Queue validation should use the dispatch runtime instead of inline execution.',
      );
    },
  }));
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
 * @param {ReturnType<typeof vi.fn>} dispatchAssignmentAndWait
 * @param {string} repo_directory
 * @returns {void}
 */
function assertQueueValidationDispatchCall(
  dispatchAssignmentAndWait,
  repo_directory,
) {
  expect(dispatchAssignmentAndWait).toHaveBeenCalledTimes(1);
  expect(dispatchAssignmentAndWait).toHaveBeenCalledWith(
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
 * @returns {Promise<typeof $k$$l$queue$k$js>}
 */
async function loadQueueModule() {
  return import('./queue.js');
}

/**
 * @param {string} repo_directory
 * @param {string} command
 * @returns {Promise<void>}
 */
async function writeQueueValidationFlow(repo_directory, command) {
  const flow_document_text = createQueueValidationFlowDocumentText(command);

  await writeFile(
    join(repo_directory, 'pravaha.json'),
    JSON.stringify(
      {
        queue: {
          validation_flow: 'docs/flows/runtime/queue-validation.yaml',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    join(repo_directory, 'docs/flows/runtime/queue-validation.yaml'),
    flow_document_text,
    'utf8',
  );
}

/**
 * @param {string} command
 * @returns {string}
 */
function createQueueValidationFlowDocumentText(command) {
  return [
    'kind: flow',
    'id: queue-validation',
    'status: active',
    'scope: repo',
    '',
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    '',
    'on:',
    '  task:',
    '    where: $class == task and status == ready',
    '',
    'jobs:',
    '  validate:',
    '    uses: core/run',
    '    with:',
    `      command: ${command}`,
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: failed',
    '',
    '  done:',
    '    end: success',
    '',
    '  failed:',
    '    end: failure',
    '',
  ].join('\n');
}
