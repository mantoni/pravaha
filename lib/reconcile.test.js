// @module-tag lint-staged-excluded

/* eslint-disable max-lines, max-lines-per-function */
/** @import { BuildGraphResult, QueryGraphApi, RepoConfigLike } from './patram-types.ts' */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

const run_query_graph = /** @type {QueryGraphApi['query_graph']} */ (
  queryGraph
);

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

it('refuses to start new reconcile work when unresolved runtime state exists', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const worktree_path = join(
    temp_directory,
    '.pravaha/worktrees/implement-runtime-slice',
  );
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecordFixture(runtime_record_path, {
      local_outcome_state: 'unresolved',
      worker_thread_id: 'thread-resume',
      worktree_path,
    });

    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('reconcile should not start a worker');
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'blocked',
      blocking_message:
        'Reconcile blocked by unresolved runtime state. Resume or resolve the recorded run before reconciling again.',
      blocking_records: [
        {
          contract_path: join(temp_directory, CONTRACT_PATH),
          local_outcome_state: 'unresolved',
          runtime_record_path,
          task_id: 'implement-runtime-slice',
          worker_thread_id: 'thread-resume',
          worktree_path,
        },
      ],
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

it('uses an ephemeral worktree assignment from the job policy', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const run_result = await reconcile(temp_directory, {
      now: () => new Date('2026-03-25T09:00:00.000Z'),
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    if (run_result.outcome === 'blocked') {
      throw new Error('Expected reconcile to start a run.');
    }

    if (typeof run_result.worktree_path !== 'string') {
      throw new Error('Expected a resolved worktree path.');
    }

    const { runtime_record } = await readRunArtifacts(run_result);

    expect(run_result.worktree_path).toContain(
      '.pravaha/worktrees/ephemeral-implement-runtime-slice-',
    );
    expect(runtime_record).toMatchObject({
      worktree: {
        identity: 'ephemeral-implement-runtime-slice-2026-03-25t09-00-00-000z',
        mode: 'ephemeral',
        path: run_result.worktree_path,
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('uses the exact named worktree slot from the job policy', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Named Worktree Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    worktree:',
      '      mode: named',
      '      slot: castello',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          to: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          to: blocked',
      '```',
      '',
    ].join('\n'),
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    if (run_result.outcome === 'blocked') {
      throw new Error('Expected reconcile to start a run.');
    }

    if (typeof run_result.worktree_path !== 'string') {
      throw new Error('Expected a resolved worktree path.');
    }

    const { runtime_record } = await readRunArtifacts(run_result);

    expect(run_result.worktree_path).toBe(
      join(temp_directory, '.pravaha/worktrees/castello'),
    );
    expect(runtime_record).toMatchObject({
      worktree: {
        identity: 'castello',
        mode: 'named',
        path: join(temp_directory, '.pravaha/worktrees/castello'),
        slot: 'castello',
      },
    });
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
    const { runtime_record, task_text } = await readRunArtifacts(run_result);

    expect(task_text).toContain('Status: review');
    expect(runtime_record).toMatchObject({
      local_outcome: {
        state: 'success',
      },
      selected_task: {
        id: 'implement-runtime-slice',
      },
      worktree: {
        mode: 'ephemeral',
      },
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
    const { runtime_record, task_text } = await readRunArtifacts(run_result);

    expect(run_result).toMatchObject({
      outcome: 'failure',
      task_id: 'implement-runtime-slice',
      worker_error: 'Codex SDK run failed',
    });
    expect(task_text).toContain('Status: blocked');
    expect(runtime_record).toMatchObject({
      local_outcome: {
        state: 'failure',
      },
      selected_task: {
        id: 'implement-runtime-slice',
      },
      worktree: {
        mode: 'ephemeral',
      },
      worker: {
        error_message: 'Codex SDK run failed',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('supports query-shaped select and explicit document transitions through the mixed graph', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Mixed Graph Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: document',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '```',
      '',
    ].join('\n'),
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });
    const contract_text = await readFile(
      join(temp_directory, CONTRACT_PATH),
      'utf8',
    );
    const task_text = await readFile(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'utf8',
    );

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
    expect(contract_text).toContain('Status: review');
    expect(task_text).toContain('Status: ready');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('keeps a downstream needs job blocked until the upstream task job is exhausted', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Scheduler Depth Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  implement_ready_tasks:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: done',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '  review_feature:',
      '    needs: [implement_ready_tasks]',
      '    if:',
      '      none($class == task and tracked_in == @document and status != done and status != dropped)',
      '    steps:',
      '      - uses: core/request-review',
      '        transition:',
      '          target: document',
      '          status: review',
      '```',
      '',
    ].join('\n'),
  });
  let worker_start_count = 0;

  try {
    const first_run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          worker_start_count += 1;

          return {
            id: 'thread-success',
            async run() {
              return {
                finalResponse: JSON.stringify({
                  summary: 'Completed the selected task.',
                }),
                items: [
                  {
                    id: 'message-1',
                    text: 'Completed the selected task.',
                    type: 'agent_message',
                  },
                ],
                usage: {
                  cached_input_tokens: 0,
                  input_tokens: 100,
                  output_tokens: 20,
                },
              };
            },
          };
        },
      },
    });
    const first_contract_text = await readFile(
      join(temp_directory, CONTRACT_PATH),
      'utf8',
    );
    const first_task_text = await readFile(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'utf8',
    );

    expect(first_run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
    expect(first_contract_text).toContain('Status: proposed');
    expect(first_task_text).toContain('Status: done');

    const second_run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('downstream contract job should not start a worker');
        },
      },
    });
    const second_contract_text = await readFile(
      join(temp_directory, CONTRACT_PATH),
      'utf8',
    );

    expect(second_run_result).toMatchObject({
      contract_path: join(temp_directory, CONTRACT_PATH),
      outcome: 'success',
      prompt: null,
      root_flow_path: join(temp_directory, FLOW_PATH),
      runtime_record_path: null,
      task_id: null,
      task_path: null,
      worker_error: null,
      worker_final_response: null,
      worker_thread_id: null,
      worktree_path: null,
    });
    expect(second_contract_text).toContain('Status: review');
    expect(worker_start_count).toBe(1);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('filters out a ready task when the job-level if condition does not match it', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Conditional Task Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  reconcile_first_ready_task:',
      '    if: $id == @task and status == blocked',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '```',
      '',
    ].join('\n'),
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('worker should not start when the job if is false');
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'no-eligible-task',
      task_id: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('runs a document-transition job without starting a worker when no if is needed', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    contract_status: 'proposed',
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Contract Transition Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  review_feature:',
      '    steps:',
      '      - transition:',
      '          target: document',
      '          status: review',
      '```',
      '',
    ].join('\n'),
    task_documents: [],
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('document-transition jobs should not start a worker');
        },
      },
    });
    const contract_text = await readFile(
      join(temp_directory, CONTRACT_PATH),
      'utf8',
    );

    expect(run_result).toMatchObject({
      outcome: 'success',
      runtime_record_path: null,
      task_id: null,
      task_path: null,
      worktree_path: null,
    });
    expect(contract_text).toContain('Status: review');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns no eligible work when a document-transition job already reached its target state', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    contract_status: 'review',
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Contract Transition Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  review_feature:',
      '    steps:',
      '      - transition:',
      '          target: document',
      '          status: review',
      '```',
      '',
    ].join('\n'),
    task_documents: [],
  });

  try {
    const run_result = await reconcile(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('document-transition jobs should not start a worker');
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'no-eligible-task',
      task_id: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails clearly when a conditional task job lacks a stable task id', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Conditional Task Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  reconcile_first_ready_task:',
      '    if: $id == @task and status == ready',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '```',
      '',
    ].join('\n'),
  });

  try {
    await expect(
      reconcile(temp_directory, {
        graph_api: {
          async load_project_graph(repo_directory) {
            return loadProjectGraph(repo_directory);
          },
          query_graph(graph, where_clause, repo_config, query_options) {
            if (where_clause.includes('root_flow:*')) {
              return {
                diagnostics: [],
                nodes: [
                  {
                    $id: 'contract:single-task-flow-reconciler',
                    $path: CONTRACT_PATH,
                    id: 'contract:single-task-flow-reconciler',
                  },
                ],
              };
            }

            if (
              where_clause.includes('tracked_in = @document') &&
              query_options?.bindings?.document ===
                'contract:single-task-flow-reconciler'
            ) {
              return {
                diagnostics: [],
                nodes: [
                  {
                    $path: 'docs/tasks/runtime/implement-runtime-slice.md',
                    id: 'task:implement-runtime-slice',
                    status: 'ready',
                  },
                ],
              };
            }

            return run_query_graph(
              graph,
              where_clause,
              repo_config,
              query_options,
            );
          },
        },
        worker_client: {
          startThread() {
            throw new Error('worker should not start');
          },
        },
      }),
    ).rejects.toThrow('Expected selected task to expose a Patram id.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails clearly when the await query does not match the mixed runtime graph', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '# Invalid Await Flow',
      '',
      '```yaml',
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == pending',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
      '```',
      '',
    ].join('\n'),
  });

  try {
    await expect(
      reconcile(temp_directory, {
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow('Await query did not match the mixed runtime graph');
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
         * @param {BuildGraphResult} graph
         * @param {string} where_clause
         * @param {RepoConfigLike | { bindings?: Record<string, string> } | undefined} repo_config_or_query_options
         * @param {{ bindings?: Record<string, string> } | undefined} query_options
         */
        query_graph(
          graph,
          where_clause,
          repo_config_or_query_options,
          query_options,
        ) {
          query_calls.push(where_clause);

          return run_query_graph(
            graph,
            where_clause,
            repo_config_or_query_options,
            query_options,
          );
        },
      },
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(query_calls).toEqual([
      '$class=contract and status in [proposed, active, blocked, review] and root_flow:*',
      '$class = task and tracked_in = @document',
      '$class = $signal and kind = worker_completed and subject = task',
      '$class = $signal and kind = worker_completed and subject = task and outcome = failure',
      '$class = $signal and kind = worker_completed and subject = task and outcome = success',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('allows reconcile again after a runtime record reaches a terminal outcome', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecordFixture(runtime_record_path, {
      completed_at: '2026-03-25T09:10:00.000Z',
      local_outcome_state: 'success',
      worker_final_response: '{"summary":"ok"}',
      worker_item_count: 1,
      worker_thread_id: 'thread-success',
      worktree_path: join(
        temp_directory,
        '.pravaha/worktrees/implement-runtime-slice',
      ),
    });

    const run_result = await reconcile(temp_directory, {
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {Awaited<ReturnType<typeof reconcile>>} run_result
 * @returns {Promise<{
 *   runtime_record: Record<string, unknown>,
 *   task_text: string,
 * }>}
 */
async function readRunArtifacts(run_result) {
  if (
    run_result.outcome === 'blocked' ||
    run_result.task_path === null ||
    run_result.runtime_record_path === null
  ) {
    throw new Error('Expected a selected task and runtime record.');
  }

  return {
    runtime_record: JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    ),
    task_text: await readFile(run_result.task_path, 'utf8'),
  };
}

/**
 * @param {string} runtime_record_path
 * @param {{
 *   completed_at?: string,
 *   local_outcome_state: 'success' | 'unresolved',
 *   worker_final_response?: string | null,
 *   worker_item_count?: number,
 *   worker_thread_id: string,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<void>}
 */
async function writeRuntimeRecordFixture(runtime_record_path, options) {
  await mkdir(dirname(runtime_record_path), { recursive: true });
  await mkdir(options.worktree_path, { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(createRuntimeRecordFixture(options), null, 2)}\n`,
  );
}

/**
 * @param {{
 *   completed_at?: string,
 *   local_outcome_state: 'success' | 'unresolved',
 *   worker_final_response?: string | null,
 *   worker_item_count?: number,
 *   worker_thread_id: string,
 *   worktree_path: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRuntimeRecordFixture(options) {
  return {
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    lease: {
      leased_at: '2026-03-25T09:00:00.000Z',
    },
    local_outcome:
      options.completed_at === undefined
        ? {
            state: options.local_outcome_state,
          }
        : {
            completed_at: options.completed_at,
            state: options.local_outcome_state,
          },
    prompt: 'Persisted prompt for resume.',
    selected_task: {
      id: 'implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
    },
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker: {
      error_message: null,
      final_response: options.worker_final_response ?? null,
      item_count: options.worker_item_count ?? 0,
      thread_id: options.worker_thread_id,
      usage: null,
    },
    worktree: {
      path: options.worktree_path,
    },
  };
}

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
          query_graph(graph, where_clause, repo_config, query_options) {
            return run_query_graph(
              graph,
              where_clause,
              repo_config,
              query_options,
            );
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
          query_graph(graph, where_clause, repo_config, query_options) {
            return run_query_graph(
              graph,
              where_clause,
              repo_config,
              query_options,
            );
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

it('falls back to the raw flow node id when no stable $id is exposed', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const run_result = await reconcile(temp_directory, {
      graph_api: {
        async load_project_graph() {
          return {
            config: {
              relations: {
                decided_by: {},
                root_flow: {},
                tracked_in: {},
              },
            },
            diagnostics: [],
            graph: {
              edges: [
                {
                  from: 'contract:single-task-flow-reconciler',
                  relation: 'root_flow',
                  to: 'flow:single-task-flow-reconciler',
                },
              ],
              nodes: {
                'flow:single-task-flow-reconciler': {
                  $path: FLOW_PATH,
                  id: 'flow:single-task-flow-reconciler',
                },
              },
            },
          };
        },
        query_graph(graph, where_clause, repo_config, query_options) {
          if (where_clause.includes('root_flow:*')) {
            return {
              diagnostics: [],
              nodes: [
                {
                  $id: 'contract:single-task-flow-reconciler',
                  $path: CONTRACT_PATH,
                  id: 'contract:single-task-flow-reconciler',
                  status: 'proposed',
                },
              ],
            };
          }

          if (
            where_clause.includes('tracked_in = @document') &&
            query_options?.bindings?.document ===
              'contract:single-task-flow-reconciler'
          ) {
            return {
              diagnostics: [],
              nodes: [
                {
                  $id: 'task:implement-runtime-slice',
                  $path: 'docs/tasks/runtime/implement-runtime-slice.md',
                  id: 'task:implement-runtime-slice',
                  status: 'ready',
                },
              ],
            };
          }

          return run_query_graph(
            graph,
            where_clause,
            repo_config,
            query_options,
          );
        },
      },
      worker_client: createSuccessWorkerHarness().worker_client,
    });

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'implement-runtime-slice',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects binding targets that do not expose the required status metadata', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      reconcile(temp_directory, {
        graph_api: {
          async load_project_graph() {
            return {
              config: {
                relations: {
                  decided_by: {},
                  root_flow: {},
                  tracked_in: {},
                },
              },
              diagnostics: [],
              graph: {
                edges: [
                  {
                    from: 'contract:single-task-flow-reconciler',
                    relation: 'root_flow',
                    to: 'flow:single-task-flow-reconciler',
                  },
                ],
                nodes: {
                  'flow:single-task-flow-reconciler': {
                    $id: 'flow:single-task-flow-reconciler',
                    $path: FLOW_PATH,
                    id: 'flow:single-task-flow-reconciler',
                  },
                },
              },
            };
          },
          query_graph(graph, where_clause, repo_config, query_options) {
            if (where_clause.includes('root_flow:*')) {
              return {
                diagnostics: [],
                nodes: [
                  {
                    $id: 'contract:single-task-flow-reconciler',
                    $path: CONTRACT_PATH,
                    id: 'contract:single-task-flow-reconciler',
                  },
                ],
              };
            }

            if (
              where_clause.includes('tracked_in = @document') &&
              query_options?.bindings?.document ===
                'contract:single-task-flow-reconciler'
            ) {
              return {
                diagnostics: [],
                nodes: [
                  {
                    $id: 'task:implement-runtime-slice',
                    $path: 'docs/tasks/runtime/implement-runtime-slice.md',
                    id: 'task:implement-runtime-slice',
                    status: 'ready',
                  },
                ],
              };
            }

            return run_query_graph(
              graph,
              where_clause,
              repo_config,
              query_options,
            );
          },
        },
        worker_client: createSuccessWorkerHarness().worker_client,
      }),
    ).rejects.toThrow(
      'Expected selected task and contract nodes to expose binding fields.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
