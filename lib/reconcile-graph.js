import { join } from 'node:path';

// @ts-expect-error patram does not publish declaration files yet.
import { loadProjectGraph, queryGraph } from 'patram';

import { compileFlowQuery } from './flow-query.js';
import { compareText } from './validation-helpers.js';

const SUPPORTED_CONTRACT_STATUSES = ['proposed', 'active', 'blocked', 'review'];

export {
  collectRelatedPaths,
  createNoEligibleTaskResult,
  queryCandidateTasks,
  resolveGraphApi,
  resolveSingleRelatedNode,
  selectFirstEligibleTask,
  selectReconcilerContract,
  stripTaskPrefix,
};

/**
 * @typedef {{
 *   $id?: string,
 *   $path?: string,
 *   id: string,
 *   status?: string,
 *   [field: string]: string | string[] | undefined,
 * }} GraphNode
 */

/**
 * @typedef {{ from: string, relation: string, to: string }} GraphEdge
 */

/**
 * @typedef {{ edges: GraphEdge[], nodes: Record<string, GraphNode> }} BuildGraphResult
 */

/**
 * @typedef {{
 *   config: unknown,
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   graph: BuildGraphResult,
 * }} ProjectGraphResult
 */

/**
 * @param {{
 *   load_project_graph?: typeof loadProjectGraph,
 *   query_graph?: typeof queryGraph,
 * } | undefined} graph_api
 */
function resolveGraphApi(graph_api) {
  return {
    load_project_graph: graph_api?.load_project_graph ?? loadProjectGraph,
    query_graph: graph_api?.query_graph ?? queryGraph,
  };
}

/**
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: typeof queryGraph }} graph_api
 * @returns {GraphNode}
 */
function selectReconcilerContract(project_graph_result, graph_api) {
  const contract_query_result = graph_api.query_graph(
    project_graph_result.graph,
    `$class=contract and status in [${SUPPORTED_CONTRACT_STATUSES.join(', ')}] and root_flow:*`,
    project_graph_result.config,
  );

  if (contract_query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(contract_query_result.diagnostics));
  }

  if (contract_query_result.nodes.length !== 1) {
    throw new Error(
      `Expected exactly one runtime contract with a root flow, found ${contract_query_result.nodes.length}.`,
    );
  }

  return contract_query_result.nodes[0];
}

/**
 * @param {GraphNode} contract_node
 * @param {string} select_query
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: typeof queryGraph }} graph_api
 * @param {{
 *   relation_names: string[],
 * }} runtime_semantics
 * @returns {GraphNode[]}
 */
function queryCandidateTasks(
  contract_node,
  select_query,
  project_graph_result,
  graph_api,
  runtime_semantics,
) {
  if (typeof contract_node.$id !== 'string') {
    throw new Error('Expected reconciler contract node to expose an id.');
  }

  const compiled_query = compileFlowQuery(
    select_query,
    {
      document: contract_node.$id,
    },
    runtime_semantics.relation_names ?? [],
  );

  const task_query_result = graph_api.query_graph(
    project_graph_result.graph,
    compiled_query,
    project_graph_result.config,
  );

  if (task_query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(task_query_result.diagnostics));
  }

  return task_query_result.nodes;
}

/**
 * @param {GraphNode[]} candidate_tasks
 * @param {BuildGraphResult} graph
 * @param {{ ready_states: Set<string>, terminal_states: Set<string> }} runtime_semantics
 * @returns {GraphNode | null}
 */
function selectFirstEligibleTask(candidate_tasks, graph, runtime_semantics) {
  for (const candidate_task of candidate_tasks) {
    if (isEligibleTask(candidate_task, graph, runtime_semantics)) {
      return candidate_task;
    }
  }

  return null;
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
 * @param {string} repo_directory
 * @param {string} contract_path
 * @param {string} flow_path
 * @returns {{
 *   contract_path: string,
 *   outcome: 'no-eligible-task',
 *   prompt: null,
 *   root_flow_path: string,
 *   runtime_record_path: null,
 *   task_id: null,
 *   task_path: null,
 *   worker_error: null,
 *   worker_final_response: null,
 *   worker_thread_id: null,
 *   worktree_path: null,
 * }}
 */
function createNoEligibleTaskResult(repo_directory, contract_path, flow_path) {
  return {
    contract_path: join(repo_directory, contract_path),
    outcome: 'no-eligible-task',
    prompt: null,
    root_flow_path: join(repo_directory, flow_path),
    runtime_record_path: null,
    task_id: null,
    task_path: null,
    worker_error: null,
    worker_final_response: null,
    worker_thread_id: null,
    worktree_path: null,
  };
}

/**
 * @param {string | undefined} task_id
 * @returns {string}
 */
function stripTaskPrefix(task_id) {
  if (typeof task_id !== 'string') {
    throw new Error('Expected selected task to expose a Patram id.');
  }

  return task_id.replace(/^task:/u, '');
}

/**
 * @param {GraphNode} task_node
 * @param {BuildGraphResult} graph
 * @param {{ ready_states: Set<string>, terminal_states: Set<string> }} runtime_semantics
 * @returns {boolean}
 */
function isEligibleTask(task_node, graph, runtime_semantics) {
  if (typeof task_node.status !== 'string') {
    return false;
  }

  if (!runtime_semantics.ready_states.has(task_node.status)) {
    return false;
  }

  return resolveRelatedNodes(task_node, 'depends_on', graph).every(
    (dependency_node) =>
      typeof dependency_node.status === 'string' &&
      runtime_semantics.terminal_states.has(dependency_node.status),
  );
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
 * @param {Array<{ file_path: string, message: string }>} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
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
