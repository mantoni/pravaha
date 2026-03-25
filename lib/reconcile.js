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

const RECONCILER_RUNTIME_LABEL = 'Pravaha single-task flow reconciler slice';

export { reconcile };

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: {
 *     load_project_graph?: (repo_directory: string) => Promise<unknown>,
 *     query_graph?: (
 *       graph: unknown,
 *       where_clause: string,
 *       repo_config?: unknown,
 *     ) => unknown,
 *   },
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
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'no-eligible-task' | 'success',
 *   prompt: string | null,
 *   root_flow_path: string,
 *   runtime_record_path: string | null,
 *   task_id: string | null,
 *   task_path: string | null,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string | null,
 * }>}
 */
async function reconcile(repo_directory, options = {}) {
  const reconcile_context = await createReconcileContext(
    repo_directory,
    options,
  );
  const candidate_tasks = queryCandidateTasks(
    reconcile_context.contract_node,
    reconcile_context.interpreted_job.select_role,
    reconcile_context.project_graph_result,
    reconcile_context.graph_api,
    reconcile_context.runtime_semantics,
  );
  const eligible_task = selectFirstEligibleTask(
    candidate_tasks,
    reconcile_context.project_graph_result.graph,
    reconcile_context.runtime_semantics,
  );

  if (eligible_task === null) {
    return createNoEligibleTaskResult(
      repo_directory,
      reconcile_context.contract_node.$path,
      reconcile_context.flow_node.$path,
    );
  }

  if (typeof eligible_task.$path !== 'string') {
    throw new Error('Expected selected task to expose a file path.');
  }

  return runTaskAttempt(repo_directory, {
    contract_path: reconcile_context.contract_node.$path,
    decision_paths: collectRelatedPaths(
      reconcile_context.contract_node,
      'decided_by',
      reconcile_context.project_graph_result.graph,
    ),
    flow_path: reconcile_context.flow_node.$path,
    now: options.now,
    runtime_label: RECONCILER_RUNTIME_LABEL,
    task_id: stripTaskPrefix(eligible_task.$id),
    task_path: eligible_task.$path,
    transition_targets: reconcile_context.interpreted_job.transition_targets,
    worker_client: options.worker_client,
  });
}

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: {
 *     load_project_graph?: (repo_directory: string) => Promise<unknown>,
 *     query_graph?: (
 *       graph: unknown,
 *       where_clause: string,
 *       repo_config?: unknown,
 *     ) => unknown,
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_node: any,
 *   flow_node: any,
 *   graph_api: any,
 *   interpreted_job: any,
 *   project_graph_result: any,
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
    runtime_semantics,
  };
}
