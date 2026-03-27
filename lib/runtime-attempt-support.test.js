/** @import { QueryGraphApi } from './patram-types.ts' */
import { queryGraph } from 'patram';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { createRuntimeRecord } from './runtime-record-model.js';
import {
  createRuntimePrompt,
  projectTaskOutcome,
} from './runtime-attempt-support.js';

const run_query_graph = /** @type {QueryGraphApi['query_graph']} */ (
  queryGraph
);

it('fails when the await query does not match the mixed runtime graph', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      projectTaskOutcome(
        temp_directory,
        createProjectTaskOutcomeOptions(temp_directory, {
          await_query: '$class == $signal and kind == review_completed',
        }),
      ),
    ).rejects.toThrow('Await query did not match the mixed runtime graph.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails when transition bindings are invalid or unresolved', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      projectTaskOutcome(
        temp_directory,
        createProjectTaskOutcomeOptions(temp_directory, {
          transition_conditions: {
            failure: '$class == $signal',
            success: '$class == $signal',
          },
        }),
      ),
    ).rejects.toThrow(
      'Expected exactly one transition condition to match the mixed runtime graph.',
    );

    await expect(
      projectTaskOutcome(
        temp_directory,
        createProjectTaskOutcomeOptions(temp_directory, {
          transition_target_bindings: {
            failure: 'task',
            success: /** @type {'task'} */ ('worker'),
          },
        }),
      ),
    ).rejects.toThrow('Missing bound transition target "worker".');

    await expect(
      projectTaskOutcome(
        temp_directory,
        createProjectTaskOutcomeOptions(temp_directory, {
          transition_target_bindings: {
            failure: 'task',
            success: 'document',
          },
        }),
      ),
    ).rejects.toThrow('Missing bound transition target "document".');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects a successful runtime outcome onto a named trigger binding', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const issue_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );
  const named_binding_targets = createNamedTriggerBindingTargets();

  try {
    await projectTaskOutcome(
      temp_directory,
      createProjectTaskOutcomeOptions(temp_directory, {
        binding_targets: named_binding_targets,
        runtime_records: [
          createCompletedRuntimeRecord(temp_directory, named_binding_targets),
        ],
        transition_target_bindings: {
          failure: 'document',
          success: 'issue',
        },
      }),
    );

    await expect(readFile(issue_path, 'utf8')).resolves.toContain(
      'Status: review',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('creates a runtime prompt and projects a successful task outcome', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const task_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );

  try {
    await expect(
      createRuntimePrompt(temp_directory, {
        contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
        decision_paths: [
          'docs/decisions/runtime/codex-sdk-happy-path-backend.md',
        ],
        flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_label: 'Runtime slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      }),
    ).resolves.toContain('Decision document');

    await projectTaskOutcome(
      temp_directory,
      createProjectTaskOutcomeOptions(temp_directory, {}),
    );

    await expect(readFile(task_path, 'utf8')).resolves.toContain(
      'Status: review',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects a failing runtime outcome onto the bound document target', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const contract_path = join(temp_directory, CONTRACT_PATH);

  try {
    await projectTaskOutcome(
      temp_directory,
      createProjectTaskOutcomeOptions(temp_directory, {
        binding_targets: {
          document: {
            id: 'contract:single-task-flow-reconciler',
            path: CONTRACT_PATH,
            status: 'proposed',
          },
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        runtime_records: [createFailedRuntimeRecord(temp_directory)],
        transition_target_bindings: {
          failure: 'document',
          success: 'task',
        },
      }),
    );

    await expect(readFile(contract_path, 'utf8')).resolves.toContain(
      'Status: blocked',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @param {Partial<Parameters<typeof projectTaskOutcome>[1]>} overrides
 * @returns {Parameters<typeof projectTaskOutcome>[1]}
 */
function createProjectTaskOutcomeOptions(temp_directory, overrides) {
  return {
    await_query: '$class == $signal and kind == worker_completed',
    binding_targets: createTaskBindingTargets(),
    durable_graph: {
      edges: [],
      nodes: {},
    },
    flow_id: 'flow:single-task-flow-reconciler',
    graph_api: {
      query_graph: run_query_graph,
    },
    relation_names: [],
    runtime_records: [createCompletedRuntimeRecord(temp_directory)],
    transition_conditions: {
      failure: '$class == $signal and outcome == failure',
      success: '$class == $signal and outcome == success',
    },
    transition_target_bindings: {
      failure: 'task',
      success: 'task',
    },
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    ...overrides,
  };
}

/**
 * @returns {{
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createTaskBindingTargets() {
  return {
    task: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  };
}

/**
 * @returns {{
 *   document: { id: string, path: string, status: string },
 *   issue: { id: string, path: string, status: string },
 * }}
 */
function createNamedTriggerBindingTargets() {
  return {
    document: {
      id: 'contract:single-task-flow-reconciler',
      path: CONTRACT_PATH,
      status: 'proposed',
    },
    issue: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  };
}

/**
 * @param {string} temp_directory
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   issue?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} [binding_targets]
 * @returns {Record<string, unknown>}
 */
function createCompletedRuntimeRecord(temp_directory, binding_targets) {
  return createRuntimeRecord({
    binding_targets: binding_targets ?? createTaskBindingTargets(),
    completed_at: '2026-03-25T12:00:00.000Z',
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'success',
    prompt: 'Persisted prompt.',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker_error: null,
    worker_final_response: '{"summary":"ok"}',
    worker_item_count: 1,
    worker_thread_id: 'thread-success',
    worker_usage: null,
    worktree_identity: 'implement-runtime-slice',
    worktree_mode: 'named',
    worktree_path: join(
      temp_directory,
      '.pravaha/worktrees/implement-runtime-slice',
    ),
  });
}

/**
 * @param {string} temp_directory
 * @returns {Record<string, unknown>}
 */
function createFailedRuntimeRecord(temp_directory) {
  return createRuntimeRecord({
    binding_targets: {
      document: {
        id: 'contract:single-task-flow-reconciler',
        path: CONTRACT_PATH,
        status: 'proposed',
      },
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    completed_at: '2026-03-25T12:00:00.000Z',
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: 'failure',
    prompt: 'Persisted prompt.',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker_error: 'worker boom',
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: 'thread-failure',
    worker_usage: null,
    worktree_identity: 'implement-runtime-slice',
    worktree_mode: 'named',
    worktree_path: join(
      temp_directory,
      '.pravaha/worktrees/implement-runtime-slice',
    ),
  });
}
