/* eslint-disable max-lines-per-function */
/** @import * as $k$$k$$l$$k$$k$$l$shared$l$types$l$patram$j$types$k$ts from '../../shared/types/patram-types.ts'; */
import { rm } from 'node:fs/promises';

import { loadProjectGraph } from 'patram';
import { expect, it } from 'vitest';

import { createRuntimeRecord } from '../records/runtime-record-model.js';
import {
  CONTRACT_PATH,
  FLOW_PATH,
  createDecisionFixture,
  createReconcilerFixtureRepo,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createResumedAttempt } from './state-machine-resume.js';

const SORTED_DECISION_EDGES = [
  {
    from: 'contract:single-task-flow-reconciler',
    relation: 'decided_by',
    to: 'decision:zeta-runtime',
  },
  {
    from: 'contract:single-task-flow-reconciler',
    relation: 'decided_by',
    to: 'decision:alpha-runtime',
  },
];

const SORTED_DECISION_NODES = {
  'contract:single-task-flow-reconciler': {
    $class: 'contract',
    $id: 'contract:single-task-flow-reconciler',
    $path: CONTRACT_PATH,
    id: 'single-task-flow-reconciler',
    status: 'proposed',
  },
  'decision:alpha-runtime': {
    $class: 'decision',
    $id: 'decision:alpha-runtime',
    $path: 'docs/decisions/runtime/alpha-runtime.md',
    id: 'alpha-runtime',
    status: 'accepted',
  },
  'decision:zeta-runtime': {
    $class: 'decision',
    $id: 'decision:zeta-runtime',
    $path: 'docs/decisions/runtime/zeta-runtime.md',
    id: 'zeta-runtime',
    status: 'accepted',
  },
  'task:implement-runtime-slice': {
    $class: 'task',
    $id: 'task:implement-runtime-slice',
    $path: 'docs/tasks/runtime/implement-runtime-slice.md',
    id: 'implement-runtime-slice',
    status: 'ready',
  },
};

it('rebuilds transient resume state from the durable graph', async () => {
  const repo_directory = await createReconcilerFixtureRepo();

  try {
    const project_graph_result = await loadProjectGraph(repo_directory);
    const resumed_attempt = await createResumedAttempt(repo_directory, {
      durable_graph: project_graph_result.graph,
      runtime_record: createResumeRuntimeRecord({
        binding_targets: {
          skipped: undefined,
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'stale',
          },
        },
        job_visit_counts: {
          implement: 1,
        },
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      }),
      runtime_record_path:
        '/repo/.pravaha/runtime/implement-runtime-slice.json',
    });

    assertRebuiltResumeState(resumed_attempt);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails closed when a persisted binding no longer exists in the current graph', async () => {
  const repo_directory = await createReconcilerFixtureRepo();

  try {
    const project_graph_result = await loadProjectGraph(repo_directory);

    await expect(
      createResumedAttempt(repo_directory, {
        durable_graph: project_graph_result.graph,
        runtime_record: createResumeRuntimeRecord({
          binding_targets: {
            task: {
              id: 'task:missing-runtime-slice',
              path: 'docs/tasks/runtime/missing-runtime-slice.md',
              status: 'ready',
            },
          },
          task_id: 'missing-runtime-slice',
          task_path: 'docs/tasks/runtime/missing-runtime-slice.md',
        }),
        runtime_record_path:
          '/repo/.pravaha/runtime/missing-runtime-slice.json',
      }),
    ).rejects.toThrow(
      'Expected runtime binding task:missing-runtime-slice (docs/tasks/runtime/missing-runtime-slice.md) to exist in the current project graph.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails when a current graph binding is missing durable identity fields', async () => {
  const repo_directory = await createReconcilerFixtureRepo();

  try {
    const project_graph_result = await loadProjectGraph(repo_directory);
    const task_node =
      project_graph_result.graph.nodes['task:implement-runtime-slice'];

    delete task_node.$path;

    await expect(
      createResumedAttempt(repo_directory, {
        durable_graph: project_graph_result.graph,
        runtime_record: createResumeRuntimeRecord({
          binding_targets: {
            task: {
              id: 'task:implement-runtime-slice',
              path: 'docs/tasks/runtime/implement-runtime-slice.md',
              status: 'ready',
            },
          },
          task_id: 'implement-runtime-slice',
          task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        }),
        runtime_record_path:
          '/repo/.pravaha/runtime/implement-runtime-slice.json',
      }),
    ).rejects.toThrow(
      'Expected runtime binding task:implement-runtime-slice (docs/tasks/runtime/implement-runtime-slice.md) to expose graph identity and path.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('sorts multiple decision paths before rebuilding the runtime prompt', async () => {
  const repo_directory = await createReconcilerFixtureRepo({
    decision_documents: [
      createDecisionFixture('zeta-runtime', 'accepted', {
        path: 'docs/decisions/runtime/zeta-runtime.md',
      }),
      createDecisionFixture('alpha-runtime', 'accepted', {
        path: 'docs/decisions/runtime/alpha-runtime.md',
      }),
    ],
  });

  try {
    const resumed_attempt = await createResumedAttempt(repo_directory, {
      durable_graph: createSortedDecisionGraph(),
      runtime_record: createResumeRuntimeRecord({
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      }),
      runtime_record_path:
        '/repo/.pravaha/runtime/implement-runtime-slice.json',
    });

    expect(
      resumed_attempt.attempt_context.prompt.indexOf(
        'Decision document (docs/decisions/runtime/alpha-runtime.md):',
      ),
    ).toBeLessThan(
      resumed_attempt.attempt_context.prompt.indexOf(
        'Decision document (docs/decisions/runtime/zeta-runtime.md):',
      ),
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('reuses the recorded pooled slot when resuming a multi-slot pooled flow', async () => {
  const repo_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    ids:',
      '      - app',
      '      - app-1',
      '  materialize:',
      '    kind: worktree',
      '    mode: pooled',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
      '',
      'jobs:',
      '  implement:',
      '    uses: core/run-codex',
      '    with:',
      '      prompt: Implement ${{ task.path }}.',
      '      reasoning: medium',
      '    next:',
      '      - if: ${{ result.outcome == "success" }}',
      '        goto: done',
      '      - goto: failed',
      '',
      '  done:',
      '    end: success',
      '',
      '  failed:',
      '    end: failure',
      '',
    ].join('\n'),
  });

  try {
    const project_graph_result = await loadProjectGraph(repo_directory);
    const resumed_attempt = await createResumedAttempt(repo_directory, {
      durable_graph: project_graph_result.graph,
      runtime_record: createResumeRuntimeRecord({
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        worktree_identity: 'pooled-app-1-main',
        worktree_mode: 'pooled',
        worktree_path: '/repo/.pravaha/worktrees/pooled-app-1-main',
        worktree_slot: 'app-1',
      }),
      runtime_record_path:
        '/repo/.pravaha/runtime/implement-runtime-slice.json',
    });

    expect(resumed_attempt.attempt_context.worktree_assignment).toMatchObject({
      identity: 'pooled-app-1-main',
      mode: 'pooled',
      slot: 'app-1',
      source_id: 'app-1',
    });
    expect(resumed_attempt.attempt_context.worktree_path).toContain(
      '.pravaha/worktrees/pooled-app-1-main',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   job_visit_counts?: Record<string, number>,
 *   task_id: string,
 *   task_path: string,
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named' | 'pooled',
 *   worktree_path?: string,
 *   worktree_slot?: string,
 * }} options
 * @returns {ReturnType<typeof createRuntimeRecord>}
 */
function createResumeRuntimeRecord(options) {
  return createRuntimeRecord({
    binding_targets: options.binding_targets ?? {
      task: {
        id: `task:${options.task_id}`,
        path: options.task_path,
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_job_name: 'implement',
    flow_path: FLOW_PATH,
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: options.job_visit_counts ?? {},
    outcome: null,
    run_id: `run:${options.task_id}:2026-03-28T10:00:00.000Z`,
    task_id: options.task_id,
    task_path: options.task_path,
    worktree_identity:
      options.worktree_identity ??
      'ephemeral-implement-runtime-slice-run-implement-runtime-slice-2026-03-28t10-00-00-000z',
    worktree_mode: options.worktree_mode ?? 'ephemeral',
    worktree_path:
      options.worktree_path ??
      '/repo/.pravaha/worktrees/ephemeral-implement-runtime-slice-run-implement-runtime-slice-2026-03-28t10-00-00-000z',
    worktree_slot: options.worktree_slot,
  });
}

/**
 * @param {Awaited<ReturnType<typeof createResumedAttempt>>} resumed_attempt
 * @returns {void}
 */
function assertRebuiltResumeState(resumed_attempt) {
  expect(resumed_attempt.attempt_context.binding_targets).toEqual({
    task: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  });
  expect(resumed_attempt.attempt_context.prompt).toContain(
    'Decision document (docs/decisions/runtime/trigger-driven-codex-runtime.md):',
  );
  expect(resumed_attempt.attempt_context.worktree_path).toContain(
    '.pravaha/worktrees/ephemeral-implement-runtime-slice-run-implement-runtime-slice-2026-03-28t10-00-00-000z',
  );
  expect(resumed_attempt.ordered_jobs).toHaveLength(3);
}

/**
 * @returns {$k$$k$$l$$k$$k$$l$shared$l$types$l$patram$j$types$k$ts.BuildGraphResult}
 */
function createSortedDecisionGraph() {
  return {
    edges: SORTED_DECISION_EDGES,
    nodes: SORTED_DECISION_NODES,
  };
}
