/* eslint-disable max-lines-per-function */
// @ts-expect-error patram does not publish declaration files yet.
import { queryGraph } from 'patram';
import { expect, it } from 'vitest';

import {
  createMixedRuntimeGraph,
  evaluateMixedGraphQuery,
  resolveQueryGraph,
} from './mixed-graph-runtime.js';

it('resolves the mixed-graph query api and creates runtime nodes', () => {
  const query_api = resolveQueryGraph(undefined);
  const mixed_graph = createMixedRuntimeGraph(
    {
      edges: [],
      nodes: {},
    },
    {
      completed_at: '2026-03-25T12:00:00.000Z',
      contract_id: 'contract:runtime',
      flow_id: 'flow:runtime',
      outcome: 'success',
      task_id: 'implement-runtime-slice',
      worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
    },
  );

  expect(query_api.query_graph).toBe(queryGraph);
  expect(mixed_graph.nodes['runtime:$signal:worker_completed']).toMatchObject({
    $class: '$signal',
    kind: 'worker_completed',
    outcome: 'success',
  });
});

it('evaluates mixed-graph queries and surfaces diagnostics', () => {
  const mixed_graph = createMixedRuntimeGraph(
    {
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
      completed_at: '2026-03-25T12:00:00.000Z',
      contract_id: 'contract:runtime',
      flow_id: 'flow:runtime',
      outcome: 'success',
      task_id: 'implement-runtime-slice',
      worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
    },
  );

  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: queryGraph,
      },
      '$class == $signal and kind == worker_completed',
      {},
      [],
    ),
  ).toBe(true);
  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: queryGraph,
      },
      '$class == task and tracked_in == document',
      {
        document: 'contract:runtime',
      },
      ['tracked_in'],
    ),
  ).toBe(true);
  expect(
    evaluateMixedGraphQuery(
      mixed_graph,
      {
        query_graph: queryGraph,
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
