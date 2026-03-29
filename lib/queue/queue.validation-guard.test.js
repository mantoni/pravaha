import { rm } from 'node:fs/promises';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createBranchCommit,
  createQueueFixtureRepo,
  writeQueueValidationFlow,
} from './queue.test-support.js';

const { loadStateMachineFlowMock } = vi.hoisted(() => ({
  loadStateMachineFlowMock: vi.fn(),
}));

vi.mock(import('../flow/reconcile-flow.js'), () => ({
  loadStateMachineFlow: loadStateMachineFlowMock,
}));

afterEach(() => {
  vi.resetModules();
  loadStateMachineFlowMock.mockReset();
});

it('rejects queue validation when the configured workspace source id is missing', async () => {
  vi.resetModules();
  loadStateMachineFlowMock.mockResolvedValue({
    ordered_jobs: [],
    start_job_name: 'validate',
    workspace: {
      materialize: {
        kind: 'worktree',
        mode: 'ephemeral',
        ref: 'refs/heads/main',
      },
      source: {
        kind: 'repo',
      },
      type: 'git.workspace',
    },
  });

  const queue_module = await import('./queue.js');
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await writeQueueValidationFlow(repo_directory, 'echo ok');
    await createBranchCommit(
      repo_directory,
      'review/invalid-workspace',
      'validated.txt',
      ['validated candidate'],
    );
    await queue_module.enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/invalid-workspace',
      run_id: 'run-invalid-workspace',
    });

    await expect(queue_module.syncQueue(repo_directory)).rejects.toThrow(
      'Expected queue validation workspace.source to expose an id.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});
