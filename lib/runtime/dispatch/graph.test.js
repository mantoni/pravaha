/** @import * as patram from 'patram'; */
import { expect, it } from 'vitest';

import {
  collectRelatedPaths,
  queryOwnerDocuments,
  resolveRelatedNodes,
  resolveSingleRelatedNode,
} from './graph.js';

it('queries owner documents without special Patram bindings', () => {
  /** @type {string | null} */
  let received_where_clause = null;
  /** @type {Record<string, string> | null} */
  let received_bindings = null;

  queryOwnerDocuments(
    '$class == task and tracked_in == contract:single-task-flow-reconciler',
    createProjectGraphResult(),
    {
      /**
       * @param {unknown} _graph
       * @param {string} where_clause
       * @param {unknown} _repo_config
       * @param {{ bindings?: Record<string, string> }} [query_options]
       */
      query_graph(_graph, where_clause, _repo_config, query_options) {
        received_where_clause = where_clause;
        received_bindings = query_options?.bindings ?? null;

        return {
          diagnostics: [],
          nodes: [],
          total_count: 0,
        };
      },
    },
  );

  expect(received_where_clause).toBe(
    '$class = task and tracked_in = contract:single-task-flow-reconciler',
  );
  expect(received_bindings).toBeNull();
});

it('surfaces diagnostics from task queries', () => {
  expect(() =>
    queryOwnerDocuments('task', createProjectGraphResult(), {
      query_graph() {
        return {
          diagnostics: [
            createPatramDiagnostic(
              'bad query',
              'docs/tasks/runtime/implement-runtime-slice.md',
            ),
          ],
          nodes: [],
          total_count: 0,
        };
      },
    }),
  ).toThrow('docs/tasks/runtime/implement-runtime-slice.md: bad query');
});

it('resolves a single related node', () => {
  const graph = {
    edges: [
      createGraphEdge(
        'contract:single-task-flow-reconciler',
        'root_flow',
        'flow:single-task-flow-reconciler',
      ),
      createGraphEdge(
        'contract:single-task-flow-reconciler',
        'decided_by',
        'decision:zeta',
      ),
      createGraphEdge(
        'contract:single-task-flow-reconciler',
        'decided_by',
        'decision:alpha',
      ),
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
        $path: 'docs/flows/runtime/single-task-flow-reconciler.js',
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
          createGraphEdge(
            'contract:single-task-flow-reconciler',
            'root_flow',
            'flow:first',
          ),
          createGraphEdge(
            'contract:single-task-flow-reconciler',
            'root_flow',
            'flow:second',
          ),
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
          createGraphEdge('task:alpha', 'depends_on', 'decision:missing'),
        ],
        nodes: {},
      },
    ),
  ).toThrow('Missing depends_on target node decision:missing.');
});

it('sorts related paths for operator-visible output', () => {
  const graph = {
    edges: [
      createGraphEdge(
        'contract:single-task-flow-reconciler',
        'decided_by',
        'decision:zeta',
      ),
      createGraphEdge(
        'contract:single-task-flow-reconciler',
        'decided_by',
        'decision:alpha',
      ),
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

it('returns zero related nodes when no matching relation exists', () => {
  expect(
    resolveRelatedNodes(
      {
        $id: 'contract:single-task-flow-reconciler',
        id: 'contract:single-task-flow-reconciler',
      },
      'root_flow',
      {
        edges: [],
        nodes: {},
      },
    ),
  ).toEqual([]);
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
          createGraphEdge(
            'contract:single-task-flow-reconciler',
            'decided_by',
            'decision:alpha',
          ),
        ],
        nodes: {
          'decision:alpha': { id: 'decision:alpha' },
        },
      },
    ),
  ).toThrow('Expected decided_by target decision:alpha to expose a path.');
});

/**
 * @returns {patram.PatramProjectGraphResult}
 */
function createProjectGraphResult() {
  return {
    claims: [],
    config: {
      include: [],
      queries: {},
      relations: {},
    },
    diagnostics: [],
    graph: {
      edges: [],
      nodes: {},
    },
    source_file_paths: [],
  };
}

/**
 * @param {string} from
 * @param {string} relation
 * @param {string} to
 * @returns {patram.PatramGraphEdge}
 */
function createGraphEdge(from, relation, to) {
  return {
    from,
    id: `${from}:${relation}:${to}`,
    origin: {
      column: 1,
      line: 1,
      path: 'docs/contracts/runtime/test.md',
    },
    relation,
    to,
  };
}

/**
 * @param {string} message
 * @param {string} path
 * @returns {patram.PatramDiagnostic}
 */
function createPatramDiagnostic(message, path) {
  return {
    code: 'test',
    column: 1,
    level: 'error',
    line: 1,
    message,
    path,
  };
}
