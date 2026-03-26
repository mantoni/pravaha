/* eslint-disable max-lines-per-function */
/** @import { BuildGraphResult, GraphApi, GraphNode, OptionalGraphApi, ProjectGraphResult, QueryGraphApi } from './patram-types.ts' */
import { runTaskAttempt } from './runtime-attempt.js';
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
import { loadSupportedJob } from './reconcile-flow.js';
import { loadRuntimeSemantics } from './reconcile-semantics.js';
import {
  createBlockedReconcileResult,
  listUnresolvedRuntimeRecords,
} from './runtime-records.js';

const RECONCILER_RUNTIME_LABEL = 'Pravaha single-task flow reconciler slice';

export { reconcile };

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   worker_client?: {
 *     startThread: (
 *       thread_options?: import('@openai/codex-sdk').ThreadOptions,
 *     ) => {
 *       id: string | null,
 *       run: (
 *         input: string,
 *         turn_options?: import('@openai/codex-sdk').TurnOptions,
 *       ) => Promise<import('@openai/codex-sdk').RunResult>,
 *     },
 *   },
 * }} [options]
 * @returns {Promise<
 *   | {
 *       blocking_message: string,
 *       blocking_records: Array<{
 *         contract_path: string | null,
 *         leased_at: string | null,
 *         local_outcome_state: string,
 *         root_flow_path: string | null,
 *         runtime_record_path: string,
 *         task_id: string | null,
 *         task_path: string | null,
 *         worker_thread_id: string | null,
 *         worktree_path: string | null,
 *       }>,
 *       outcome: 'blocked',
 *     }
 *   | {
 *       contract_path: string,
 *       outcome: 'failure' | 'no-eligible-task' | 'success',
 *       prompt: string | null,
 *       root_flow_path: string,
 *       runtime_record_path: string | null,
 *       task_id: string | null,
 *       task_path: string | null,
 *       worker_error: string | null,
 *       worker_final_response: string | null,
 *       worker_thread_id: string | null,
 *       worktree_path: string | null,
 *     }
 * >}
 */
async function reconcile(repo_directory, options = {}) {
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);

  if (unresolved_runtime_records.length > 0) {
    return createBlockedReconcileResult(
      repo_directory,
      unresolved_runtime_records,
    );
  }

  const reconcile_context = await createReconcileContext(
    repo_directory,
    options,
  );
  const candidate_tasks = queryCandidateTasks(
    reconcile_context.contract_node,
    reconcile_context.interpreted_job.select_query,
    reconcile_context.project_graph_result,
    reconcile_context.graph_api,
    {
      relation_names: reconcile_context.relation_names,
    },
  );
  const eligible_task = selectFirstEligibleTask(
    candidate_tasks,
    reconcile_context.project_graph_result.graph,
    reconcile_context.runtime_semantics,
  );

  if (eligible_task === null) {
    return createNoEligibleTaskResult(
      repo_directory,
      readRequiredNodePath(
        reconcile_context.contract_node,
        'reconciler contract',
      ),
      readRequiredNodePath(reconcile_context.flow_node, 'root flow'),
    );
  }

  return runTaskAttempt(repo_directory, {
    await_query: reconcile_context.interpreted_job.await_query,
    binding_targets: createBindingTargets(
      reconcile_context.contract_node,
      eligible_task,
    ),
    contract_path: readRequiredNodePath(
      reconcile_context.contract_node,
      'reconciler contract',
    ),
    durable_graph: reconcile_context.project_graph_result.graph,
    decision_paths: collectRelatedPaths(
      reconcile_context.contract_node,
      'decided_by',
      reconcile_context.project_graph_result.graph,
    ),
    flow_path: readRequiredNodePath(reconcile_context.flow_node, 'root flow'),
    flow_id: readRequiredNodeId(reconcile_context.flow_node, 'root flow'),
    graph_api: {
      query_graph: reconcile_context.graph_api.query_graph,
    },
    now: options.now,
    relation_names: reconcile_context.relation_names,
    runtime_label: RECONCILER_RUNTIME_LABEL,
    task_id: stripTaskPrefix(eligible_task.$id),
    task_path: readRequiredNodePath(eligible_task, 'selected task'),
    transition_conditions:
      reconcile_context.interpreted_job.transition_conditions,
    transition_target_bindings:
      reconcile_context.interpreted_job.transition_target_bindings,
    transition_targets: reconcile_context.interpreted_job.transition_targets,
    worktree_policy: reconcile_context.interpreted_job.worktree_policy,
    worker_client: options.worker_client,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 * }} options
 * @returns {Promise<{
 *   contract_node: GraphNode,
 *   flow_node: GraphNode,
 *   graph_api: GraphApi,
 *   interpreted_job: any,
 *   project_graph_result: ProjectGraphResult,
 *   relation_names: string[],
 *   runtime_semantics: any,
 * }>}
 */
async function createReconcileContext(repo_directory, options) {
  const graph_api = resolveGraphApi(options.graph_api);
  const project_graph_result =
    await graph_api.load_project_graph(repo_directory);
  const runtime_semantics = await loadRuntimeSemantics(repo_directory);
  const contract_node = selectReconcilerContract(
    project_graph_result,
    graph_api,
  );
  const flow_node = resolveSingleRelatedNode(
    contract_node,
    'root_flow',
    project_graph_result.graph,
  );

  if (
    typeof contract_node.$path !== 'string' ||
    typeof flow_node.$path !== 'string'
  ) {
    throw new Error(
      'Expected reconciler contract and flow nodes to expose file paths.',
    );
  }

  return {
    contract_node,
    flow_node,
    graph_api,
    interpreted_job: await loadSupportedJob(repo_directory, flow_node.$path),
    project_graph_result,
    relation_names: Object.keys(project_graph_result.config.relations ?? {}),
    runtime_semantics,
  };
}

/**
 * @param {GraphNode} contract_node
 * @param {GraphNode} task_node
 * @returns {{
 *   document: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createBindingTargets(contract_node, task_node) {
  if (
    typeof contract_node.$id !== 'string' ||
    typeof contract_node.$path !== 'string' ||
    typeof contract_node.status !== 'string' ||
    typeof task_node.$id !== 'string' ||
    typeof task_node.status !== 'string'
  ) {
    throw new Error(
      'Expected selected task and contract nodes to expose binding fields.',
    );
  }

  if (typeof task_node.$path !== 'string') {
    throw new Error('Expected selected task to expose a file path.');
  }

  return {
    document: {
      id: contract_node.$id,
      path: contract_node.$path,
      status: contract_node.status,
    },
    task: {
      id: task_node.$id,
      path: task_node.$path,
      status: task_node.status,
    },
  };
}

/**
 * @param {GraphNode} graph_node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeId(graph_node, label) {
  if (typeof graph_node.$id === 'string') {
    return graph_node.$id;
  }

  if (typeof graph_node.id === 'string') {
    return graph_node.id;
  }

  throw new Error(`Expected ${label} to expose a stable graph id.`);
}

/**
 * @param {GraphNode} graph_node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodePath(graph_node, label) {
  if (typeof graph_node.$path === 'string') {
    return graph_node.$path;
  }

  throw new Error(`Expected ${label} to expose a file path.`);
}
