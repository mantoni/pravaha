/** @import { DiagnosticLike, BuildGraphResult, GraphNode, GraphApi, OptionalGraphApi, ProjectGraphResult } from './shared/types/patram-types.ts' */

import { loadProjectGraph, queryGraph } from 'patram';

import { compileFlowQuery, createQueryBindings } from './flow/query.js';
import { compareText } from './shared/diagnostics/validation-helpers.js';

export {
  collectRelatedPaths,
  queryCandidateTasks,
  resolveGraphApi,
  resolveSingleRelatedNode,
};

/**
 * @param {OptionalGraphApi | undefined} graph_api
 * @returns {GraphApi}
 */
function resolveGraphApi(graph_api) {
  return {
    load_project_graph:
      graph_api?.load_project_graph ??
      /** @type {GraphApi['load_project_graph']} */ (loadProjectGraph),
    query_graph:
      graph_api?.query_graph ??
      /** @type {GraphApi['query_graph']} */ (queryGraph),
  };
}

/**
 * @param {GraphNode} contract_node
 * @param {string} select_query
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @returns {GraphNode[]}
 */
function queryCandidateTasks(
  contract_node,
  select_query,
  project_graph_result,
  graph_api,
) {
  if (typeof contract_node.$id !== 'string') {
    throw new Error('Expected reconciler contract node to expose an id.');
  }

  const task_query_result = graph_api.query_graph(
    project_graph_result.graph,
    compileFlowQuery(select_query),
    project_graph_result.config,
    createQueryBindings({
      document: contract_node.$id,
    }),
  );

  if (task_query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(task_query_result.diagnostics));
  }

  return task_query_result.nodes;
}

/**
 * @param {GraphNode} source_node
 * @param {string} relation_name
 * @param {BuildGraphResult} graph
 * @returns {GraphNode}
 */
function resolveSingleRelatedNode(source_node, relation_name, graph) {
  const related_nodes = resolveRelatedNodes(source_node, relation_name, graph);

  if (related_nodes.length !== 1) {
    throw new Error(
      `Expected exactly one ${relation_name} target for ${source_node.$id ?? source_node.id}, found ${related_nodes.length}.`,
    );
  }

  return related_nodes[0];
}

/**
 * @param {GraphNode} source_node
 * @param {string} relation_name
 * @param {BuildGraphResult} graph
 * @returns {string[]}
 */
function collectRelatedPaths(source_node, relation_name, graph) {
  return resolveRelatedNodes(source_node, relation_name, graph)
    .map((related_node) => {
      if (typeof related_node.$path !== 'string') {
        throw new Error(
          `Expected ${relation_name} target ${related_node.$id ?? related_node.id} to expose a path.`,
        );
      }

      return related_node.$path;
    })
    .sort(compareText);
}

/**
 * @param {GraphNode} source_node
 * @param {string} relation_name
 * @param {BuildGraphResult} graph
 * @returns {GraphNode[]}
 */
function resolveRelatedNodes(source_node, relation_name, graph) {
  return graph.edges
    .filter(
      (graph_edge) =>
        graph_edge.from === source_node.id &&
        graph_edge.relation === relation_name,
    )
    .map((graph_edge) => {
      const target_node = graph.nodes[graph_edge.to];

      if (target_node === undefined) {
        throw new Error(
          `Missing ${relation_name} target node ${graph_edge.to}.`,
        );
      }

      return target_node;
    })
    .sort(compareGraphNodes);
}

/**
 * @param {DiagnosticLike[]} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.path ?? diagnostic.file_path ?? '<unknown>'}: ${diagnostic.message}`,
    )
    .join('\n');
}

/**
 * @param {GraphNode} left_node
 * @param {GraphNode} right_node
 * @returns {number}
 */
function compareGraphNodes(left_node, right_node) {
  return (left_node.$id ?? left_node.id).localeCompare(
    right_node.$id ?? right_node.id,
    'en',
  );
}
