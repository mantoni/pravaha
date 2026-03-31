import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createFixtureRepoFromFiles } from '../../test/fixtures/runtime-fixture.js';
import {
  createBranchCommit,
  createQueueFixtureRepo,
  parseRuntimeRecord,
  writeQueueValidationFlow,
} from './queue.test-support.js';

const { loadExecutableDispatchFlowMock } = vi.hoisted(() => ({
  loadExecutableDispatchFlowMock: vi.fn(),
}));

vi.mock(import('../flow/reconcile-flow.js'), () => ({
  loadExecutableDispatchFlow: loadExecutableDispatchFlowMock,
}));

afterEach(() => {
  vi.resetModules();
  loadExecutableDispatchFlowMock.mockReset();
});

it('rejects queue validation when the configured workspace id is missing', async () => {
  vi.resetModules();
  loadExecutableDispatchFlowMock.mockResolvedValue(
    createJavaScriptDispatchFlow({
      workspace_id: '',
    }),
  );

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
      'Expected queue validation workspace.id to be a non-empty string.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects queue validation when the referenced workspace id is undefined in config', async () => {
  vi.resetModules();
  loadExecutableDispatchFlowMock.mockResolvedValue(
    createJavaScriptDispatchFlow({
      workspace_id: 'missing-workspace',
    }),
  );

  const queue_module = await import('./queue.js');
  const repo_directory = await createQueueFixtureRepo({
    branch_step_lines: ['  done:', '    end: success'],
  });

  try {
    await writeQueueValidationFlow(repo_directory, 'echo ok');
    await createBranchCommit(
      repo_directory,
      'review/missing-config',
      'validated.txt',
      ['validated candidate'],
    );
    await queue_module.enqueueQueueHandoff(repo_directory, {
      branch_value: 'review/missing-config',
      run_id: 'run-missing-config',
    });

    await expect(queue_module.syncQueue(repo_directory)).rejects.toThrow(
      'Flow workspace.id "missing-workspace" is not defined in pravaha.json workspaces.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects non-object runtime record payloads in queue test support', () => {
  expect(() => parseRuntimeRecord('[]')).toThrow(
    'Expected runtime record JSON to evaluate to an object.',
  );
});

it('rejects non-object pravaha.json values when writing queue validation flow', async () => {
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-queue-validation-',
    {},
  );

  try {
    await writeFile(join(repo_directory, 'pravaha.json'), '[]\n');

    await expect(
      writeQueueValidationFlow(repo_directory, 'echo ok'),
    ).rejects.toThrow('Expected pravaha.json to contain one object.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('surfaces pravaha config diagnostics before loading the queue validation flow', async () => {
  vi.resetModules();
  const { loadQueueValidationFlow } = await import('./queue-validation.js');
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-queue-validation-',
    {},
  );

  try {
    await writeFile(join(repo_directory, 'pravaha.json'), '{broken\n');

    await expect(
      loadQueueValidationFlow(
        repo_directory,
        'docs/flows/runtime/queue-validation.js',
      ),
    ).rejects.toThrow('Cannot load JSON file:');
    expect(loadExecutableDispatchFlowMock).not.toHaveBeenCalled();
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   workspace_id: string,
 * }} options
 * @returns {{
 *   flow: {
 *     handlers: {
 *       main: () => void,
 *     },
 *     trigger: {
 *       owner_class: string,
 *       query_text: string,
 *     },
 *     workspace: {
 *       id: string,
 *     },
 *   },
 *   surface: 'javascript-module',
 * }}
 */
function createJavaScriptDispatchFlow(options) {
  return {
    flow: {
      handlers: {
        main() {},
      },
      trigger: {
        owner_class: 'task',
        query_text: '$class = task and status = ready',
      },
      workspace: {
        id: options.workspace_id,
      },
    },
    surface: 'javascript-module',
  };
}
