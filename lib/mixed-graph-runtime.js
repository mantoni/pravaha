// @ts-expect-error patram does not publish declaration files yet.
import { queryGraph } from 'patram';

import { compileFlowQuery } from './flow-query.js';

export { createMixedRuntimeGraph, evaluateMixedGraphQuery, resolveQueryGraph };

/**
 * @param {{
 *   query_graph?: typeof queryGraph,
 * } | undefined} graph_api
 * @returns {{ query_graph: typeof queryGraph }}
 */
function resolveQueryGraph(graph_api) {
  return {
    query_graph: graph_api?.query_graph ?? queryGraph,
  };
}

/**
 * @param {{
 *   edges: Array<{ from: string, relation: string, to: string }>,
 *   nodes: Record<string, Record<string, unknown>>,
 * }} durable_graph
 * @param {{
 *   completed_at: string,
 *   contract_id: string,
 *   flow_id: string,
 *   outcome: 'failure' | 'success',
 *   task_id: string,
 *   worktree_identity?: string,
 *   worktree_mode?: 'ephemeral' | 'named',
 *   worktree_path: string,
 * }} options
 * @returns {{
 *   edges: Array<{ from: string, relation: string, to: string }>,
 *   nodes: Record<string, Record<string, unknown>>,
 * }}
 */
function createMixedRuntimeGraph(durable_graph, options) {
  return {
    edges: [...durable_graph.edges],
    nodes: {
      ...durable_graph.nodes,
      'runtime:$flow_instance:current': {
        $class: '$flow_instance',
        $id: '$flow_instance:current',
        flow_document: options.flow_id,
        id: 'runtime:$flow_instance:current',
        root_document: options.contract_id,
        state: 'completed',
      },
      'runtime:$lease:current': {
        $class: '$lease',
        $id: '$lease:current',
        id: 'runtime:$lease:current',
        owner: 'pravaha',
        state: 'held',
        subject: 'task',
      },
      'runtime:$signal:worker_completed': {
        $class: '$signal',
        $id: '$signal:worker_completed',
        emitted_at: options.completed_at,
        id: 'runtime:$signal:worker_completed',
        kind: 'worker_completed',
        outcome: options.outcome,
        subject: 'task',
      },
      'runtime:$worker:current': {
        $class: '$worker',
        $id: '$worker:current',
        backend: 'codex-sdk',
        id: 'runtime:$worker:current',
        state: options.outcome,
        subject: 'task',
        worktree: options.worktree_path,
      },
      'runtime:$worktree:current': {
        $class: '$worktree',
        $id: '$worktree:current',
        id: 'runtime:$worktree:current',
        mode: options.worktree_mode ?? 'named',
        name: options.worktree_identity ?? options.task_id,
        path: options.worktree_path,
        state: 'prepared',
      },
    },
  };
}

/**
 * @param {{
 *   edges: Array<{ from: string, relation: string, to: string }>,
 *   nodes: Record<string, Record<string, unknown>>,
 * }} mixed_graph
 * @param {{
 *   query_graph: typeof queryGraph,
 * }} graph_api
 * @param {string} query_text
 * @param {Record<string, string>} relation_bindings
 * @param {string[]} relation_names
 * @returns {boolean}
 */
function evaluateMixedGraphQuery(
  mixed_graph,
  graph_api,
  query_text,
  relation_bindings,
  relation_names,
) {
  const query_result = graph_api.query_graph(
    mixed_graph,
    compileFlowQuery(query_text, relation_bindings, relation_names),
  );

  if (query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(query_result.diagnostics));
  }

  return query_result.nodes.length > 0;
}

/**
 * @param {Array<{ file_path: string, message: string }>} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
    .join('\n');
}
