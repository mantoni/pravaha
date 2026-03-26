/* eslint-disable max-lines, max-lines-per-function */
/** @import { QueryGraphApi } from './patram-types.ts' */
import { queryGraph } from 'patram';
import { expect, it } from 'vitest';

import {
  createMixedRuntimeGraph,
  evaluateMixedGraphQuery,
  resolveQueryGraph,
} from './mixed-graph-runtime.js';
import { createRuntimeRecord } from './runtime-record-model.js';

const run_query_graph = /** @type {QueryGraphApi['query_graph']} */ (
  queryGraph
);

it('resolves the mixed-graph query api and creates active runtime nodes from the current run record', () => {
  const query_api = resolveQueryGraph(undefined);
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: createBindingTargets(),
      flow_id: 'flow:runtime',
      runtime_records: [createActiveRuntimeRecord()],
    },
  );

  expect(query_api.query_graph).toBe(run_query_graph);
  expect(mixed_graph.nodes['runtime:$flow_instance:current']).toMatchObject({
    $class: '$flow_instance',
    state: 'active',
  });
  expect(mixed_graph.nodes['runtime:$lease:current']).toMatchObject({
    $class: '$lease',
    state: 'held',
  });
  expect(mixed_graph.nodes['runtime:$worker:current']).toMatchObject({
    $class: '$worker',
    state: 'running',
    thread_id: 'thread-active',
  });
  expect(mixed_graph.nodes['runtime:$worktree:current']).toMatchObject({
    $class: '$worktree',
    mode: 'named',
    path: '/repo/.pravaha/worktrees/castello',
  });
  expect(mixed_graph.nodes['runtime:$signal:worker_completed']).toBeUndefined();
});

it('retains the terminal signal and current flow state after completion but expires short-lived operational nodes', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: createBindingTargets(),
      flow_id: 'flow:runtime',
      runtime_records: [createTerminalRuntimeRecord('thread-success')],
    },
  );

  expect(mixed_graph.nodes['runtime:$flow_instance:current']).toMatchObject({
    $class: '$flow_instance',
    state: 'completed',
  });
  expect(mixed_graph.nodes['runtime:$signal:worker_completed']).toMatchObject({
    $class: '$signal',
    kind: 'worker_completed',
    outcome: 'success',
  });
  expect(mixed_graph.nodes['runtime:$lease:current']).toBeUndefined();
  expect(mixed_graph.nodes['runtime:$worker:current']).toBeUndefined();
  expect(mixed_graph.nodes['runtime:$worktree:current']).toBeUndefined();
});

it('replaces an older retained terminal snapshot with the latest matching completed run', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: createBindingTargets(),
      flow_id: 'flow:runtime',
      runtime_records: [
        createTerminalRuntimeRecord('thread-old', {
          completed_at: '2026-03-25T12:00:00.000Z',
          leased_at: '2026-03-25T11:00:00.000Z',
          outcome: 'success',
          worker_final_response: '{"summary":"old"}',
          worker_item_count: 1,
        }),
        createTerminalRuntimeRecord('thread-new', {
          completed_at: '2026-03-25T13:00:00.000Z',
          leased_at: '2026-03-25T12:30:00.000Z',
          outcome: 'failure',
          worker_error: 'new failure',
          worker_final_response: null,
          worker_item_count: 0,
        }),
      ],
    },
  );

  expect(mixed_graph.nodes['runtime:$flow_instance:current']).toMatchObject({
    $class: '$flow_instance',
    state: 'completed',
  });
  expect(mixed_graph.nodes['runtime:$signal:worker_completed']).toMatchObject({
    emitted_at: '2026-03-25T13:00:00.000Z',
    outcome: 'failure',
  });
});

it('evaluates mixed-graph queries against the current run and ignores unrelated stale runtime records', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      document_node_ids: {
        'docs/contracts/runtime/runtime-node-lifecycle.md': 'contract:runtime',
      },
      edges: [
        {
          from: 'task:implement-runtime-slice',
          relation: 'tracked_in',
          to: 'contract:runtime',
        },
      ],
      nodes: {
        'contract:runtime': {
          $class: 'contract',
          id: 'contract:runtime',
          status: 'proposed',
        },
        'task:implement-runtime-slice': {
          $class: 'task',
          id: 'task:implement-runtime-slice',
          status: 'ready',
        },
      },
    },
    {
      binding_targets: createBindingTargets(),
      flow_id: 'flow:runtime',
      runtime_records: [
        createActiveRuntimeRecord(),
        createRuntimeRecord({
          binding_targets: {
            task: {
              id: 'task:stale-history',
              path: 'docs/tasks/runtime/stale-history.md',
              status: 'review',
            },
          },
          completed_at: '2026-03-24T12:00:00.000Z',
          contract_path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
          flow_path: 'docs/flows/runtime/runtime-node-lifecycle.md',
          leased_at: '2026-03-24T11:00:00.000Z',
          outcome: 'success',
          prompt: 'Old prompt.',
          task_id: 'stale-history',
          task_path: 'docs/tasks/runtime/stale-history.md',
          transition_targets: {
            failure: 'blocked',
            success: 'review',
          },
          worker_error: null,
          worker_final_response: '{"summary":"old"}',
          worker_item_count: 1,
          worker_thread_id: 'thread-old',
          worker_usage: null,
          worktree_identity: 'stale-history',
          worktree_mode: 'ephemeral',
          worktree_path: '/repo/.pravaha/worktrees/stale-history',
        }),
      ],
    },
  );

  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: run_query_graph,
      },
      '$class == $flow_instance and state == active',
      {},
      [],
    ),
  ).toBe(true);
  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: run_query_graph,
      },
      '$class == $signal and kind == worker_completed',
      {},
      [],
    ),
  ).toBe(false);
  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: run_query_graph,
      },
      '$class == task and tracked_in == @document',
      {
        document: 'contract:runtime',
      },
      ['tracked_in'],
    ),
  ).toBe(true);
  expect(mixed_graph.document_node_ids).toEqual({
    'docs/contracts/runtime/runtime-node-lifecycle.md': 'contract:runtime',
  });
  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: run_query_graph,
      },
      '$class == $signal and kind == review_completed',
      {},
      [],
    ),
  ).toBe(false);
  expect(() =>
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph() {
          return {
            diagnostics: [
              {
                file_path: 'flow.md',
                message: 'bad query',
              },
            ],
            nodes: [],
          };
        },
      },
      '$class == $signal',
      {},
      [],
    ),
  ).toThrow('flow.md: bad query');
});

it('falls back to legacy selected-task matching and omits the worktree node when no worktree is recorded', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: {
        document: {
          id: 'contract:runtime',
          path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
          status: 'proposed',
        },
        task: {
          id: 'task:legacy-runtime',
          path: 'docs/tasks/runtime/legacy-runtime.md',
          status: 'ready',
        },
      },
      flow_id: 'flow:runtime',
      runtime_records: [
        {
          contract_path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
          flow_path: 'docs/flows/runtime/runtime-node-lifecycle.md',
          lease: {
            leased_at: '2026-03-25T11:00:00.000Z',
          },
          local_outcome: {
            state: 'unresolved',
          },
          prompt: 'Legacy prompt.',
          selected_task: {
            id: 'legacy-runtime',
            path: 'docs/tasks/runtime/legacy-runtime.md',
          },
          transition_targets: {
            failure: 'blocked',
            success: 'review',
          },
          worker: {
            thread_id: 'thread-legacy',
          },
        },
      ],
    },
  );

  expect(mixed_graph.nodes['runtime:$flow_instance:current']).toMatchObject({
    root_document: 'contract:runtime',
    state: 'active',
  });
  expect(mixed_graph.nodes['runtime:$worker:current']).toMatchObject({
    thread_id: 'thread-legacy',
  });
  expect(mixed_graph.nodes['runtime:$worktree:current']).toBeUndefined();
});

it('projects document-scoped retained signals when only the root document is bound', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: {
        document: {
          id: 'contract:runtime',
          path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
          status: 'proposed',
        },
      },
      flow_id: 'flow:runtime',
      runtime_records: [
        createRuntimeRecord({
          binding_targets: {
            document: {
              id: 'contract:runtime',
              path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
              status: 'proposed',
            },
          },
          completed_at: '2026-03-25T12:00:00.000Z',
          contract_path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
          flow_path: 'docs/flows/runtime/runtime-node-lifecycle.md',
          leased_at: '2026-03-25T11:00:00.000Z',
          outcome: 'failure',
          prompt: 'Persisted prompt.',
          task_id: 'document-scope',
          task_path: 'docs/tasks/runtime/document-scope.md',
          transition_targets: {
            failure: 'blocked',
            success: 'review',
          },
          worker_error: 'failed',
          worker_final_response: null,
          worker_item_count: 0,
          worker_thread_id: 'thread-document',
          worker_usage: null,
          worktree_identity: 'document-scope',
          worktree_mode: 'named',
          worktree_path: '/repo/.pravaha/worktrees/document-scope',
        }),
      ],
    },
  );

  expect(mixed_graph.nodes['runtime:$signal:worker_completed']).toMatchObject({
    outcome: 'failure',
    subject: 'document',
  });
});

it('fails closed when more than one runtime record matches the current run', () => {
  expect(() =>
    createMixedRuntimeGraph(
      {
        edges: [],
        nodes: {},
      },
      {
        binding_targets: createBindingTargets(),
        flow_id: 'flow:runtime',
        runtime_records: [
          createActiveRuntimeRecord({
            worker_thread_id: 'thread-a',
          }),
          createActiveRuntimeRecord({
            leased_at: '2026-03-25T11:05:00.000Z',
            worker_thread_id: 'thread-b',
          }),
        ],
      },
    ),
  ).toThrow('Expected at most one active runtime record for the current run.');
});

it('returns only the durable graph when no runtime record matches the current bindings', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {
        'contract:runtime': {
          $class: 'contract',
          id: 'contract:runtime',
          status: 'proposed',
        },
      },
    },
    {
      binding_targets: createBindingTargets(),
      flow_id: 'flow:runtime',
      runtime_records: [],
    },
  );

  expect(mixed_graph.nodes).toEqual({
    'contract:runtime': {
      $class: 'contract',
      id: 'contract:runtime',
      status: 'proposed',
    },
  });
});

it('fails closed when more than one retained terminal runtime record matches the current run', () => {
  expect(() =>
    createMixedRuntimeGraph(
      {
        edges: [],
        nodes: {},
      },
      {
        binding_targets: createBindingTargets(),
        flow_id: 'flow:runtime',
        runtime_records: [
          createTerminalRuntimeRecord('thread-a', {
            completed_at: '2026-03-25T12:00:00.000Z',
          }),
          createTerminalRuntimeRecord('thread-b', {
            completed_at: '2026-03-25T12:00:00.000Z',
          }),
        ],
      },
    ),
  ).toThrow(
    'Expected exactly one current retained terminal runtime record for the current run.',
  );
});

it('uses the runtime record document binding when the flow binds only the current task', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      binding_targets: {
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      flow_id: 'flow:runtime',
      runtime_records: [createActiveRuntimeRecord()],
    },
  );

  expect(mixed_graph.nodes['runtime:$flow_instance:current']).toMatchObject({
    root_document: 'contract:runtime',
  });
});

/**
 * @returns {{
 *   document: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createBindingTargets() {
  return {
    document: {
      id: 'contract:runtime',
      path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
      status: 'proposed',
    },
    task: {
      id: 'task:implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
      status: 'ready',
    },
  };
}

/**
 * @param {Partial<{
 *   binding_targets: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   leased_at: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_thread_id: string | null,
 *   worktree_identity: string,
 *   worktree_mode: 'ephemeral' | 'named',
 *   worktree_path: string,
 *   worktree_slot: string,
 * }>} overrides
 * @returns {Parameters<typeof createRuntimeRecord>[0]}
 */
function createRuntimeRecordOptions(overrides = {}) {
  /** @type {Parameters<typeof createRuntimeRecord>[0]} */
  const default_options = {
    contract_path: 'docs/contracts/runtime/runtime-node-lifecycle.md',
    flow_path: 'docs/flows/runtime/runtime-node-lifecycle.md',
    leased_at: '2026-03-25T11:00:00.000Z',
    outcome: null,
    prompt: 'Persisted prompt.',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: 'thread-active',
    worker_usage: null,
    worktree_identity: 'castello',
    worktree_mode: 'named',
    worktree_path: '/repo/.pravaha/worktrees/castello',
    worktree_slot: 'castello',
  };

  return {
    ...default_options,
    ...overrides,
    binding_targets: overrides.binding_targets ?? createBindingTargets(),
  };
}

/**
 * @param {Partial<{
 *   binding_targets: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   leased_at: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_thread_id: string | null,
 *   worktree_identity: string,
 *   worktree_mode: 'ephemeral' | 'named',
 *   worktree_path: string,
 *   worktree_slot: string,
 * }>} overrides
 * @returns {Record<string, unknown>}
 */
function createActiveRuntimeRecord(overrides = {}) {
  return createRuntimeRecord(createRuntimeRecordOptions(overrides));
}

/**
 * @param {string} worker_thread_id
 * @param {Partial<{
 *   completed_at: string,
 *   leased_at: string,
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 * }>} overrides
 * @returns {Record<string, unknown>}
 */
function createTerminalRuntimeRecord(worker_thread_id, overrides = {}) {
  return createRuntimeRecord({
    ...createRuntimeRecordOptions({
      leased_at: overrides.leased_at,
      worker_thread_id,
    }),
    completed_at: overrides.completed_at ?? '2026-03-25T12:00:00.000Z',
    outcome: overrides.outcome ?? 'success',
    worker_error: overrides.worker_error ?? null,
    worker_final_response:
      overrides.worker_final_response ?? '{"summary":"ok"}',
    worker_item_count: overrides.worker_item_count ?? 1,
  });
}
