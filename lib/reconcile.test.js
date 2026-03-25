import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// @ts-expect-error patram does not publish declaration files yet.
import { loadProjectGraph, queryGraph } from 'patram';
import { expect, it } from 'vitest';

import { createSuccessWorkerHarness } from './run-happy-path.assertions-test-helpers.js';
import {
  CONTRACT_PATH,
  createDecisionFixture,
  createReconcilerFixtureRepo,
  createTaskFixture,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { reconcile } from './reconcile.js';

it('reports when no eligible task is available for the reconciler flow', async () => {
  const blocked_decision = createDecisionFixture(
    'pending-human-choice',
    'active',
  );
  const temp_directory = await createReconcilerFixtureRepo({
    decision_documents: [
      createDecisionFixture('codex-sdk-happy-path-backend', 'accepted'),
      blocked_decision,
    ],
    task_documents: [
      createTaskFixture('implement-runtime-slice', 'ready', {
        depends_on: [blocked_decision.path],
      }),
    ],
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('worker should not start without an eligible task');
        },
      },
    });

    expect(run_result).toMatchObject({
      contract_path: join(temp_directory, CONTRACT_PATH),
      outcome: 'no-eligible-task',
      root_flow_path: join(temp_directory, FLOW_PATH),
      runtime_record_path: null,
      task_id: null,
      task_path: null,
      worktree_path: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('runs one eligible task from the interpreted reconciler flow', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const worker_harness = createSuccessWorkerHarness();

  try {
    const run_result = await reconcile(temp_directory, {
      now: () => new Date('2026-03-25T09:00:00.000Z'),
      worker_client: worker_harness.worker_client,
    });

    expect(run_result).toMatchObject({
      contract_path: join(temp_directory, CONTRACT_PATH),
      outcome: 'success',
      root_flow_path: join(temp_directory, FLOW_PATH),
      task_id: 'implement-runtime-slice',
      task_path: join(
        temp_directory,
        'docs/tasks/runtime/implement-runtime-slice.md',
      ),
    });
    expect(worker_harness.received_prompt()).toContain(CONTRACT_PATH);
    expect(worker_harness.received_prompt()).toContain(FLOW_PATH);
    expect(worker_harness.received_prompt()).toContain(
      'docs/tasks/runtime/implement-runtime-slice.md',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('selects the first eligible task in Patram query result order', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    task_documents: [
      createTaskFixture('zeta-task', 'ready'),
      createTaskFixture('alpha-task', 'ready'),
    ],
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });
    const zeta_task_text = await readFile(
      join(temp_directory, 'docs/tasks/runtime/zeta-task.md'),
      'utf8',
    );

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'alpha-task',
    });
    expect(zeta_task_text).toContain('Status: ready');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects a successful worker outcome from ready to review', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    if (
      run_result.task_path === null ||
      run_result.runtime_record_path === null
    ) {
      throw new Error('Expected a selected task and runtime record.');
    }

    const task_text = await readFile(run_result.task_path, 'utf8');
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(task_text).toContain('Status: review');
    expect(runtime_record).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects a failed worker outcome from ready to blocked', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          return {
            id: 'thread-failure',
            async run() {
              throw new Error('Codex SDK run failed');
            },
          };
        },
      },
    });

    if (
      run_result.task_path === null ||
      run_result.runtime_record_path === null
    ) {
      throw new Error('Expected a selected task and runtime record.');
    }

    const task_text = await readFile(run_result.task_path, 'utf8');
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result).toMatchObject({
      outcome: 'failure',
      task_id: 'implement-runtime-slice',
      worker_error: 'Codex SDK run failed',
    });
    expect(task_text).toContain('Status: blocked');
    expect(runtime_record).toMatchObject({
      outcome: 'failure',
      task_id: 'implement-runtime-slice',
      worker: {
        error_message: 'Codex SDK run failed',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads and queries the project graph through the Patram library API', async () => {
  /** @type {string[]} */
  const query_calls = [];
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await reconcile(temp_directory, {
      graph_api: {
        /**
         * @param {string} repo_directory
         */
        async load_project_graph(repo_directory) {
          return loadProjectGraph(repo_directory);
        },
        /**
         * @param {unknown} graph
         * @param {string} where_clause
         * @param {unknown} repo_config
         */
        query_graph(graph, where_clause, repo_config) {
          query_calls.push(where_clause);

          return queryGraph(graph, where_clause, repo_config);
        },
      },
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(query_calls).toEqual([
      '$id=contract:single-task-flow-reconciler and status in [proposed, active, blocked, review]',
      '$class=task and tracked_in=contract:single-task-flow-reconciler',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a selected task without a file path', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      reconcile(temp_directory, {
        graph_api: {
          async load_project_graph(repo_directory) {
            const project_graph_result = await loadProjectGraph(repo_directory);
            const task_node =
              project_graph_result.graph.nodes['task:implement-runtime-slice'];

            if (task_node !== undefined) {
              delete task_node.$path;
            }

            return project_graph_result;
          },
          query_graph(graph, where_clause, repo_config) {
            return queryGraph(graph, where_clause, repo_config);
          },
        },
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow('Expected selected task to expose a file path.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler binding without a flow file path', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      reconcile(temp_directory, {
        graph_api: {
          async load_project_graph(repo_directory) {
            const project_graph_result = await loadProjectGraph(repo_directory);
            const flow_node =
              project_graph_result.graph.nodes[
                'flow:single-task-flow-reconciler'
              ];

            if (flow_node !== undefined) {
              delete flow_node.$path;
            }

            return project_graph_result;
          },
          query_graph(graph, where_clause, repo_config) {
            return queryGraph(graph, where_clause, repo_config);
          },
        },
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow(
      'Expected reconciler contract and flow nodes to expose file paths.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
