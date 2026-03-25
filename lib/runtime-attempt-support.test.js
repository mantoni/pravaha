// @ts-expect-error patram does not publish declaration files yet.
import { queryGraph } from 'patram';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createReconcilerFixtureRepo } from './reconcile.fixture-test-helpers.js';
import { projectTaskOutcome } from './runtime-attempt-support.js';

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
    ).rejects.toThrow('Unsupported transition binding "worker".');

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

/**
 * @param {string} temp_directory
 * @param {Partial<Parameters<typeof projectTaskOutcome>[1]>} overrides
 * @returns {Parameters<typeof projectTaskOutcome>[1]}
 */
function createProjectTaskOutcomeOptions(temp_directory, overrides) {
  return {
    await_query: '$class == $signal and kind == worker_completed',
    binding_targets: {
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    completed_at: '2026-03-25T12:00:00.000Z',
    durable_graph: {
      edges: [],
      nodes: {},
    },
    flow_id: 'flow:single-task-flow-reconciler',
    graph_api: {
      query_graph: queryGraph,
    },
    outcome: 'success',
    relation_names: [],
    task_id: 'implement-runtime-slice',
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
    worktree_path: join(
      temp_directory,
      '.pravaha/worktrees/implement-runtime-slice',
    ),
    ...overrides,
  };
}
