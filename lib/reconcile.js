/* eslint-disable max-lines, max-lines-per-function */
/** @import { GraphApi, GraphNode, OptionalGraphApi, ProjectGraphResult } from './patram-types.ts' */
import { join } from 'node:path';

import { loadSupportedFlow } from './reconcile-flow.js';
import {
  collectRelatedPaths,
  createNoEligibleTaskResult,
  evaluateGraphCondition,
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
import { updateDocumentStatus } from './runtime-files.js';
import { runTaskAttempt } from './runtime-attempt.js';

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
  const scheduled_job = selectNextRunnableJob(reconcile_context);

  if (scheduled_job === null) {
    return createNoEligibleTaskResult(
      repo_directory,
      readRequiredNodePath(
        reconcile_context.contract_node,
        'reconciler contract',
      ),
      readRequiredNodePath(reconcile_context.flow_node, 'root flow'),
    );
  }

  if (scheduled_job.kind === 'document-transition') {
    return runDocumentTransitionJob(
      repo_directory,
      reconcile_context,
      scheduled_job.job,
    );
  }

  return runTaskAttempt(repo_directory, {
    await_query: scheduled_job.job.await_query,
    binding_targets: createBindingTargets(
      reconcile_context.contract_node,
      scheduled_job.task_node,
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
    task_id: stripTaskPrefix(scheduled_job.task_node.$id),
    task_path: readRequiredNodePath(scheduled_job.task_node, 'selected task'),
    transition_conditions: scheduled_job.job.transition_conditions,
    transition_target_bindings: scheduled_job.job.transition_target_bindings,
    transition_targets: scheduled_job.job.transition_targets,
    worktree_policy: scheduled_job.job.worktree_policy,
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
 *   interpreted_flow: Awaited<ReturnType<typeof loadSupportedFlow>>,
 *   project_graph_result: ProjectGraphResult,
 *   relation_names: string[],
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
    interpreted_flow: await loadSupportedFlow(repo_directory, flow_node.$path),
    project_graph_result,
    relation_names: Object.keys(project_graph_result.config.relations ?? {}),
    runtime_semantics,
  };
}

/**
 * @param {Awaited<ReturnType<typeof createReconcileContext>>} reconcile_context
 * @returns {{
 *   kind: 'document-transition',
 *   job: {
 *     if_query: string | null,
 *     job_name: string,
 *     kind: 'document-transition',
 *     needs: string[],
 *     transition_target_binding: 'document',
 *     transition_target_state: string,
 *   },
 * } | {
 *   kind: 'selected-task',
 *   job: {
 *     await_query: string,
 *     if_query: string | null,
 *     job_name: string,
 *     kind: 'selected-task',
 *     needs: string[],
 *     select_query: string,
 *     select_role: string,
 *     transition_conditions: { failure: string, success: string },
 *     transition_target_bindings: { failure: string, success: string },
 *     transition_targets: { failure: string, success: string },
 *     worktree_policy:
 *       | { mode: 'ephemeral' }
 *       | { mode: 'named', slot: string },
 *   },
 *   task_node: GraphNode,
 * } | null}
 */
function selectNextRunnableJob(reconcile_context) {
  /** @type {Set<string>} */
  const exhausted_jobs = new Set();

  for (const supported_job of reconcile_context.interpreted_flow.ordered_jobs) {
    if (
      !supported_job.needs.every((job_name) => exhausted_jobs.has(job_name))
    ) {
      continue;
    }

    if (supported_job.kind === 'document-transition') {
      if (isRunnableDocumentTransitionJob(reconcile_context, supported_job)) {
        return {
          kind: 'document-transition',
          job: supported_job,
        };
      }

      exhausted_jobs.add(supported_job.job_name);
      continue;
    }

    const candidate_tasks = queryCandidateTasks(
      reconcile_context.contract_node,
      supported_job.select_query,
      reconcile_context.project_graph_result,
      reconcile_context.graph_api,
    );
    const eligible_task = selectFirstEligibleTask(
      candidate_tasks,
      reconcile_context.project_graph_result.graph,
      reconcile_context.runtime_semantics,
      (task_node) =>
        isTaskConditionSatisfied(reconcile_context, supported_job, task_node),
    );

    if (eligible_task !== null) {
      return {
        kind: 'selected-task',
        job: supported_job,
        task_node: eligible_task,
      };
    }

    exhausted_jobs.add(supported_job.job_name);
  }

  return null;
}

/**
 * @param {Awaited<ReturnType<typeof createReconcileContext>>} reconcile_context
 * @param {{
 *   await_query: string,
 *   if_query: string | null,
 *   job_name: string,
 *   kind: 'selected-task',
 *   needs: string[],
 *   select_query: string,
 *   select_role: string,
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worktree_policy:
 *     | { mode: 'ephemeral' }
 *     | { mode: 'named', slot: string },
 * }} supported_job
 * @param {GraphNode} task_node
 * @returns {boolean}
 */
function isTaskConditionSatisfied(reconcile_context, supported_job, task_node) {
  if (supported_job.if_query === null) {
    return true;
  }

  return evaluateGraphCondition(
    reconcile_context.project_graph_result.graph,
    supported_job.if_query,
    reconcile_context.project_graph_result,
    reconcile_context.graph_api,
    createRelationBindings(reconcile_context.contract_node, task_node),
  );
}

/**
 * @param {Awaited<ReturnType<typeof createReconcileContext>>} reconcile_context
 * @param {{
 *   if_query: string | null,
 *   job_name: string,
 *   kind: 'document-transition',
 *   needs: string[],
 *   transition_target_binding: 'document',
 *   transition_target_state: string,
 * }} supported_job
 * @returns {boolean}
 */
function isRunnableDocumentTransitionJob(reconcile_context, supported_job) {
  if (
    typeof reconcile_context.contract_node.status !== 'string' ||
    reconcile_context.contract_node.status ===
      supported_job.transition_target_state
  ) {
    return false;
  }

  if (supported_job.if_query === null) {
    return true;
  }

  return evaluateGraphCondition(
    reconcile_context.project_graph_result.graph,
    supported_job.if_query,
    reconcile_context.project_graph_result,
    reconcile_context.graph_api,
    createRelationBindings(reconcile_context.contract_node),
  );
}

/**
 * @param {string} repo_directory
 * @param {Awaited<ReturnType<typeof createReconcileContext>>} reconcile_context
 * @param {{
 *   if_query: string | null,
 *   job_name: string,
 *   kind: 'document-transition',
 *   needs: string[],
 *   transition_target_binding: 'document',
 *   transition_target_state: string,
 * }} supported_job
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'success',
 *   prompt: null,
 *   root_flow_path: string,
 *   runtime_record_path: null,
 *   task_id: null,
 *   task_path: null,
 *   worker_error: null,
 *   worker_final_response: null,
 *   worker_thread_id: null,
 *   worktree_path: null,
 * }>}
 */
async function runDocumentTransitionJob(
  repo_directory,
  reconcile_context,
  supported_job,
) {
  const contract_path = readRequiredNodePath(
    reconcile_context.contract_node,
    'reconciler contract',
  );
  const contract_status = readRequiredNodeStatus(
    reconcile_context.contract_node,
    'reconciler contract',
  );
  const flow_path = readRequiredNodePath(
    reconcile_context.flow_node,
    'root flow',
  );

  await updateDocumentStatus(
    join(repo_directory, contract_path),
    contract_status,
    supported_job.transition_target_state,
  );

  return {
    contract_path: join(repo_directory, contract_path),
    outcome: 'success',
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
 * @param {GraphNode} contract_node
 * @param {GraphNode} [task_node]
 * @returns {Record<string, string>}
 */
function createRelationBindings(contract_node, task_node) {
  if (typeof contract_node.$id !== 'string') {
    throw new Error('Expected reconciler contract node to expose an id.');
  }

  /** @type {Record<string, string>} */
  const relation_bindings = {
    document: contract_node.$id,
  };

  if (task_node !== undefined) {
    if (typeof task_node.$id !== 'string') {
      throw new Error('Expected selected task to expose a Patram id.');
    }

    relation_bindings.task = task_node.$id;
  }

  return relation_bindings;
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

/**
 * @param {GraphNode} graph_node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeStatus(graph_node, label) {
  if (typeof graph_node.status === 'string') {
    return graph_node.status;
  }

  throw new Error(`Expected ${label} to expose a status.`);
}
