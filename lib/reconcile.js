/**
 * Interpreted reconcile entrypoint for checked-in runtime flows.
 *
 * Decided by: ../docs/decisions/runtime/trigger-driven-codex-runtime.md
 * Decided by: ../docs/decisions/runtime/job-and-step-execution-semantics.md
 * Decided by: ../docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
 * Implements: ../docs/contracts/runtime/single-task-flow-reconciler.md
 * Implements: ../docs/contracts/runtime/mixed-graph-flow-surface.md
 * @patram
 */
/** @import { GraphApi, GraphNode, OptionalGraphApi, ProjectGraphResult } from './patram-types.ts' */
import { loadExecutableFlow } from './reconcile-flow.js';
import {
  createNoEligibleTaskResult,
  queryCandidateTasks,
  resolveGraphApi,
  resolveSingleRelatedNode,
  selectFirstEligibleTask,
  selectReconcilerContract,
  stripTaskPrefix,
} from './reconcile-graph.js';
import { loadRuntimeSemantics } from './reconcile-semantics.js';
import {
  createBlockedReconcileResult,
  listUnresolvedRuntimeRecords,
} from './runtime-records.js';
import { runStateMachineAttempt } from './runtime-attempt.js';

const RECONCILER_RUNTIME_LABEL = 'Pravaha single-task flow reconciler slice';

export { reconcile };

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
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
 *       outcome: 'failure' | 'no-eligible-task' | 'pending-approval' | 'success',
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
  const interpreted_flow = reconcile_context.interpreted_flow;
  const eligible_task = selectStateMachineTaskNode(reconcile_context);

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

  return runStateMachineAttempt(repo_directory, {
    binding_targets: createBindingTargets(
      reconcile_context.contract_node,
      eligible_task,
    ),
    contract_path: readRequiredNodePath(
      reconcile_context.contract_node,
      'reconciler contract',
    ),
    flow_path: readRequiredNodePath(reconcile_context.flow_node, 'root flow'),
    now: options.now,
    operator_io: options.operator_io,
    ordered_jobs: interpreted_flow.flow.ordered_jobs,
    runtime_label: RECONCILER_RUNTIME_LABEL,
    start_job_name: interpreted_flow.flow.start_job_name,
    task_id: stripTaskPrefix(eligible_task.$id),
    task_path: readRequiredNodePath(eligible_task, 'selected task'),
    worker_client: options.worker_client,
    workspace: interpreted_flow.flow.workspace,
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
 *   interpreted_flow: Awaited<ReturnType<typeof loadExecutableFlow>>,
 *   project_graph_result: ProjectGraphResult,
 *   runtime_semantics: {
 *     ready_states: Set<string>,
 *     terminal_states: Set<string>,
 *   },
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

  /* istanbul ignore next -- Patram project graphs always expose checked-in paths */
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
    interpreted_flow: await loadExecutableFlow(repo_directory, flow_node.$path),
    project_graph_result,
    runtime_semantics,
  };
}

/**
 * @param {Awaited<ReturnType<typeof createReconcileContext>>} reconcile_context
 * @returns {GraphNode | null}
 */
function selectStateMachineTaskNode(reconcile_context) {
  const state_machine_flow = reconcile_context.interpreted_flow.flow;
  const candidate_tasks = queryCandidateTasks(
    reconcile_context.contract_node,
    state_machine_flow.trigger.query_text,
    reconcile_context.project_graph_result,
    reconcile_context.graph_api,
  );

  return selectFirstEligibleTask(
    candidate_tasks,
    reconcile_context.project_graph_result.graph,
    reconcile_context.runtime_semantics,
    () => true,
  );
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
  /* istanbul ignore next -- eligible graph nodes are expected to expose binding fields */
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

  /* istanbul ignore next -- eligible graph nodes are expected to expose checked-in paths */
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
function readRequiredNodePath(graph_node, label) {
  if (typeof graph_node.$path === 'string') {
    return graph_node.$path;
  }

  /* istanbul ignore next -- checked-in Patram nodes always expose file paths */
  throw new Error(`Expected ${label} to expose a file path.`);
}
