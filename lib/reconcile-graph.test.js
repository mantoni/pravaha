import { expect, it } from 'vitest';

import {
  collectRelatedPaths,
  createNoEligibleTaskResult,
  queryCandidateTasks,
  resolveGraphApi,
  resolveSingleRelatedNode,
  selectFirstEligibleTask,
  selectReconcilerContract,
  stripTaskPrefix,
} from './reconcile-graph.js';

it('resolves default Patram graph APIs', () => {
  expect(resolveGraphApi(undefined)).toMatchObject({
    load_project_graph: expect.any(Function),
    query_graph: expect.any(Function),
  });
});

it('selects the reconciler contract from the Patram query result', () => {
  const contract_node = {
    $id: 'contract:single-task-flow-reconciler',
    $path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    id: 'contract:single-task-flow-reconciler',
  };

  expect(
    selectReconcilerContract(
      {
        config: {},
        diagnostics: [],
        graph: { edges: [], nodes: {} },
      },
      {
        query_graph() {
          return {
            diagnostics: [],
            nodes: [contract_node],
          };
        },
      },
    ),
  ).toBe(contract_node);
});

it('surfaces diagnostics from reconciler contract selection', () => {
  expect(() =>
    selectReconcilerContract(
      {
        config: {},
        diagnostics: [],
        graph: { edges: [], nodes: {} },
      },
      {
        query_graph() {
          return {
            diagnostics: [
              {
                file_path:
                  'docs/contracts/runtime/single-task-flow-reconciler.md',
                message: 'bad query',
              },
            ],
            nodes: [],
          };
        },
      },
    ),
  ).toThrow('docs/contracts/runtime/single-task-flow-reconciler.md: bad query');
});

it('rejects unknown semantic roles in task selection', () => {
  expect(() =>
    queryCandidateTasks(
      {
        $id: 'contract:single-task-flow-reconciler',
        id: 'contract:single-task-flow-reconciler',
      },
      'worker',
      {
        config: {},
        diagnostics: [],
        graph: { edges: [], nodes: {} },
      },
      {
        query_graph() {
          throw new Error('query should not run');
        },
      },
      {
        role_targets: new Map([['task', ['task']]]),
      },
    ),
  ).toThrow('Unknown semantic role "worker" in reconciler flow.');
});

it('rejects task selection without a stable contract id', () => {
  expect(() =>
    queryCandidateTasks(
      { id: 'contract:single-task-flow-reconciler' },
      'task',
      {
        config: {},
        diagnostics: [],
        graph: { edges: [], nodes: {} },
      },
      {
        query_graph() {
          throw new Error('query should not run');
        },
      },
      {
        role_targets: new Map([['task', ['task']]]),
      },
    ),
  ).toThrow('Expected reconciler contract node to expose an id.');
});

it('surfaces diagnostics from task queries', () => {
  expect(() =>
    queryCandidateTasks(
      {
        $id: 'contract:single-task-flow-reconciler',
        id: 'contract:single-task-flow-reconciler',
      },
      'task',
      {
        config: {},
        diagnostics: [],
        graph: { edges: [], nodes: {} },
      },
      {
        query_graph() {
          return {
            diagnostics: [
              {
                file_path: 'docs/tasks/runtime/implement-runtime-slice.md',
                message: 'bad query',
              },
            ],
            nodes: [],
          };
        },
      },
      {
        role_targets: new Map([['task', ['task']]]),
      },
    ),
  ).toThrow('docs/tasks/runtime/implement-runtime-slice.md: bad query');
});

it('selects the first ready task whose dependencies are terminal', () => {
  const graph = {
    edges: [
      {
        from: 'task:alpha',
        relation: 'depends_on',
        to: 'decision:blocked',
      },
      {
        from: 'task:beta',
        relation: 'depends_on',
        to: 'decision:done',
      },
    ],
    nodes: {
      'decision:blocked': { id: 'decision:blocked', status: 'active' },
      'decision:done': { id: 'decision:done', status: 'done' },
    },
  };

  expect(
    selectFirstEligibleTask(
      [
        { $id: 'task:alpha', id: 'task:alpha', status: 'ready' },
        { $id: 'task:beta', id: 'task:beta', status: 'ready' },
      ],
      graph,
      {
        ready_states: new Set(['ready']),
        terminal_states: new Set(['done']),
      },
    ),
  ).toMatchObject({ $id: 'task:beta' });
});

it('resolves a single related node', () => {
  const graph = {
    edges: [
      {
        from: 'contract:single-task-flow-reconciler',
        relation: 'root_flow',
        to: 'flow:single-task-flow-reconciler',
      },
      {
        from: 'contract:single-task-flow-reconciler',
        relation: 'decided_by',
        to: 'decision:zeta',
      },
      {
        from: 'contract:single-task-flow-reconciler',
        relation: 'decided_by',
        to: 'decision:alpha',
      },
    ],
    nodes: {
      'decision:alpha': {
        $path: 'docs/decisions/runtime/alpha.md',
        id: 'decision:alpha',
      },
      'decision:zeta': {
        $path: 'docs/decisions/runtime/zeta.md',
        id: 'decision:zeta',
      },
      'flow:single-task-flow-reconciler': {
        $path: 'docs/flows/runtime/single-task-flow-reconciler.md',
        id: 'flow:single-task-flow-reconciler',
      },
    },
  };
  const contract_node = {
    $id: 'contract:single-task-flow-reconciler',
    id: 'contract:single-task-flow-reconciler',
  };

  expect(resolveSingleRelatedNode(contract_node, 'root_flow', graph)).toEqual(
    graph.nodes['flow:single-task-flow-reconciler'],
  );
});

it('rejects ambiguous related nodes', () => {
  expect(() =>
    resolveSingleRelatedNode(
      {
        $id: 'contract:single-task-flow-reconciler',
        id: 'contract:single-task-flow-reconciler',
      },
      'root_flow',
      {
        edges: [
          {
            from: 'contract:single-task-flow-reconciler',
            relation: 'root_flow',
            to: 'flow:first',
          },
          {
            from: 'contract:single-task-flow-reconciler',
            relation: 'root_flow',
            to: 'flow:second',
          },
        ],
        nodes: {
          'flow:first': { id: 'flow:first' },
          'flow:second': { id: 'flow:second' },
        },
      },
    ),
  ).toThrow('Expected exactly one root_flow target');
});

it('rejects missing related target nodes', () => {
  expect(() =>
    resolveSingleRelatedNode(
      {
        $id: 'task:alpha',
        id: 'task:alpha',
      },
      'depends_on',
      {
        edges: [
          {
            from: 'task:alpha',
            relation: 'depends_on',
            to: 'decision:missing',
          },
        ],
        nodes: {},
      },
    ),
  ).toThrow('Missing depends_on target node decision:missing.');
});

it('sorts related paths for operator-visible output', () => {
  const graph = {
    edges: [
      {
        from: 'contract:single-task-flow-reconciler',
        relation: 'decided_by',
        to: 'decision:zeta',
      },
      {
        from: 'contract:single-task-flow-reconciler',
        relation: 'decided_by',
        to: 'decision:alpha',
      },
    ],
    nodes: {
      'decision:alpha': {
        $path: 'docs/decisions/runtime/alpha.md',
        id: 'decision:alpha',
      },
      'decision:zeta': {
        $path: 'docs/decisions/runtime/zeta.md',
        id: 'decision:zeta',
      },
    },
  };
  const contract_node = {
    $id: 'contract:single-task-flow-reconciler',
    id: 'contract:single-task-flow-reconciler',
  };

  expect(collectRelatedPaths(contract_node, 'decided_by', graph)).toEqual([
    'docs/decisions/runtime/alpha.md',
    'docs/decisions/runtime/zeta.md',
  ]);
});

it('rejects related nodes that do not expose paths', () => {
  expect(() =>
    collectRelatedPaths(
      {
        $id: 'contract:single-task-flow-reconciler',
        id: 'contract:single-task-flow-reconciler',
      },
      'decided_by',
      {
        edges: [
          {
            from: 'contract:single-task-flow-reconciler',
            relation: 'decided_by',
            to: 'decision:alpha',
          },
        ],
        nodes: {
          'decision:alpha': { id: 'decision:alpha' },
        },
      },
    ),
  ).toThrow('Expected decided_by target decision:alpha to expose a path.');
});

it('renders the no-eligible-task result and validates task ids', () => {
  expect(
    createNoEligibleTaskResult(
      '/repo',
      'docs/contracts/runtime/single-task-flow-reconciler.md',
      'docs/flows/runtime/single-task-flow-reconciler.md',
    ),
  ).toMatchObject({
    contract_path:
      '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
    outcome: 'no-eligible-task',
    task_id: null,
  });
  expect(stripTaskPrefix('task:alpha')).toBe('alpha');
  expect(() => stripTaskPrefix(undefined)).toThrow(
    'Expected selected task to expose a Patram id.',
  );
});
