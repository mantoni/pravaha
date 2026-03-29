/** @import { GraphApi, GraphNode, ProjectGraphResult } from '../../shared/types/patram-types.ts' */
/* eslint-disable complexity, max-lines, max-lines-per-function, jsdoc/prefer-import-tag */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { globby } from 'globby';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { loadExecutableDispatchFlow } from '../../flow/reconcile-flow.js';
import {
  collectRelatedPaths,
  queryCandidateTasks,
  resolveRelatedNodes,
  resolveSingleRelatedNode,
} from './graph.js';
import {
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
} from '../records/runtime-record-model.js';
import { listUnresolvedRuntimeRecords } from '../records/runtime-records.js';
import {
  resumeTaskAttempt,
  runStateMachineAttempt,
} from '../attempts/state-machine.js';
import {
  DISPATCH_RUNTIME_LABEL,
  SUPPORTED_DISPATCH_CONTRACT_STATUSES,
  formatDiagnostics,
  readAssignmentExecutionContext,
  readRequiredNodeId,
  readRequiredNodePath,
  readRequiredNodeStatus,
} from './context.js';

export { executeAssignedFlowInstance, materializePendingAssignments };

/**
 * @param {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: {
 *     load_project_graph: (repo_directory: string) => Promise<ProjectGraphResult>,
 *     query_graph: GraphApi['query_graph'],
 *   },
 *   log_to_operator: (line: string) => void,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory?: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: Record<string, unknown>,
 * }} shared_context
 * @returns {Promise<{
 *   outcome: 'failure' | 'pending-approval' | 'success',
 *   worker_error: string | null,
 * }>}
 */
async function executeAssignedFlowInstance(assignment, shared_context) {
  const execution_context = readAssignmentExecutionContext(shared_context);

  if (typeof assignment.resume_runtime_record_path === 'string') {
    const runtime_record = parseRuntimeRecord(
      await readFile(assignment.resume_runtime_record_path, 'utf8'),
    );
    const project_graph_result =
      await execution_context.graph_api.load_project_graph(
        execution_context.repo_directory,
      );

    return resumeTaskAttempt(execution_context.repo_directory, {
      durable_graph: project_graph_result.graph,
      graph_api: {
        query_graph: execution_context.graph_api.query_graph,
      },
      now: execution_context.now,
      operator_io: execution_context.operator_io,
      relation_names: Object.keys(project_graph_result.config.relations ?? {}),
      runtime_record,
      runtime_record_path: assignment.resume_runtime_record_path,
    });
  }

  if (
    Array.isArray(assignment.ordered_jobs) &&
    typeof assignment.start_job_name === 'string' &&
    assignment.workspace !== undefined &&
    assignment.binding_targets !== undefined &&
    typeof assignment.contract_path === 'string' &&
    typeof assignment.flow_path === 'string' &&
    typeof assignment.task_id === 'string' &&
    typeof assignment.task_path === 'string'
  ) {
    return runStateMachineAttempt(execution_context.repo_directory, {
      binding_targets: assignment.binding_targets,
      contract_path: assignment.contract_path,
      flow_path: assignment.flow_path,
      now: execution_context.now,
      operator_io: execution_context.operator_io,
      ordered_jobs: assignment.ordered_jobs,
      runtime_label: DISPATCH_RUNTIME_LABEL,
      start_job_name: assignment.start_job_name,
      task_id: assignment.task_id,
      task_path: assignment.task_path,
      workspace: assignment.workspace,
    });
  }

  throw new Error(
    `Assignment ${assignment.assignment_id} is missing required state-machine execution fields.`,
  );
}

/**
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api: {
 *     load_project_graph: (repo_directory: string) => Promise<ProjectGraphResult>,
 *     query_graph: GraphApi['query_graph'],
 *   },
 *   log_to_operator: (line: string) => void,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: Record<string, unknown>,
 * }} shared_context
 * @returns {Promise<Array<Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>>}
 */
async function materializePendingAssignments(shared_context) {
  /** @type {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} */
  const pending_assignments = new Map();
  /** @type {Set<string>} */
  const reserved_flow_instance_ids = new Set();
  const unresolved_runtime_records = await listUnresolvedRuntimeRecords(
    shared_context.repo_directory,
  );

  for (const unresolved_runtime_record of unresolved_runtime_records) {
    const unresolved_flow_instance_id = readRuntimeRecordFlowInstanceId(
      unresolved_runtime_record.record,
    );

    if (typeof unresolved_flow_instance_id === 'string') {
      reserved_flow_instance_ids.add(unresolved_flow_instance_id);
    }

    const assignment = createResumeAssignment(unresolved_runtime_record);

    if (assignment !== null) {
      pending_assignments.set(assignment.flow_instance_id, assignment);
    }
  }

  const project_graph_result =
    await shared_context.graph_api.load_project_graph(
      shared_context.repo_directory,
    );
  const pravaha_config_result = await loadPravahaConfig(
    shared_context.repo_directory,
  );

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(pravaha_config_result.diagnostics));
  }

  const contract_nodes = queryDispatchContracts(project_graph_result, {
    query_graph: shared_context.graph_api.query_graph,
  });
  const fallback_flow_candidates = await loadFallbackFlowCandidates(
    shared_context.repo_directory,
    project_graph_result,
    pravaha_config_result.config.flow_config.default_matches,
  );

  for (const contract_node of contract_nodes) {
    const contract_path = readRequiredNodePath(
      contract_node,
      'dispatch contract',
    );
    const flow_nodes = resolveRelatedNodes(
      contract_node,
      'root_flow',
      project_graph_result.graph,
    );

    if (flow_nodes.length > 0) {
      collectFlowAssignments(
        contract_node,
        {
          dispatch_flow: await loadExecutableDispatchFlow(
            shared_context.repo_directory,
            readRequiredNodePath(flow_nodes[0], 'dispatch flow'),
          ),
          flow_node: resolveSingleRelatedNode(
            contract_node,
            'root_flow',
            project_graph_result.graph,
          ),
          flow_path: readRequiredNodePath(flow_nodes[0], 'dispatch flow'),
        },
        contract_path,
        pending_assignments,
        reserved_flow_instance_ids,
        project_graph_result,
        shared_context.graph_api,
      );
      continue;
    }

    collectFallbackAssignments(
      contract_node,
      contract_path,
      fallback_flow_candidates,
      pending_assignments,
      reserved_flow_instance_ids,
      project_graph_result,
      shared_context.graph_api,
    );
  }

  return Array.from(pending_assignments.values()).sort((left, right) =>
    left.flow_instance_id.localeCompare(right.flow_instance_id, 'en'),
  );
}

/**
 * @param {{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }} unresolved_runtime_record
 * @returns {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }> | null}
 */
function createResumeAssignment(unresolved_runtime_record) {
  const approval = getRuntimeRecordApproval(unresolved_runtime_record.record);

  if (approval?.approved_at === null) {
    return null;
  }

  const flow_instance_id = readRuntimeRecordFlowInstanceId(
    unresolved_runtime_record.record,
  );

  if (flow_instance_id === null) {
    return null;
  }

  return {
    assignment_id: flow_instance_id,
    flow_instance_id,
    resume_runtime_record_path: unresolved_runtime_record.runtime_record_path,
    type: 'assignment',
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function readRuntimeRecordFlowInstanceId(runtime_record) {
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const contract_path = getRuntimeRecordContractPath(runtime_record);
  const flow_path = getRuntimeRecordFlowPath(runtime_record);

  if (
    binding_targets === null ||
    typeof contract_path !== 'string' ||
    typeof flow_path !== 'string'
  ) {
    return null;
  }

  const [binding_name, binding_target] =
    selectFlowInstanceBinding(binding_targets);

  return createFlowInstanceId(
    contract_path,
    flow_path,
    binding_name,
    binding_target.id,
  );
}

/**
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @returns {GraphNode[]}
 */
function queryDispatchContracts(project_graph_result, graph_api) {
  const query_result = graph_api.query_graph(
    project_graph_result.graph,
    `$class=contract and status in [${SUPPORTED_DISPATCH_CONTRACT_STATUSES.join(', ')}]`,
    project_graph_result.config,
  );

  if (query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(query_result.diagnostics));
  }

  return query_result.nodes;
}

/**
 * @param {string} repo_directory
 * @param {ProjectGraphResult} project_graph_result
 * @param {string[]} default_matches
 * @returns {Promise<Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }>>}
 */
async function loadFallbackFlowCandidates(
  repo_directory,
  project_graph_result,
  default_matches,
) {
  if (default_matches.length === 0) {
    return [];
  }

  const flow_paths = [
    ...new Set(
      await globby(default_matches, {
        cwd: repo_directory,
        expandDirectories: false,
        gitignore: true,
        onlyFiles: true,
      }),
    ),
  ].sort((left_path, right_path) => left_path.localeCompare(right_path, 'en'));
  const flow_nodes_by_path = createFlowNodesByPath(project_graph_result.graph);

  return Promise.all(
    flow_paths.map(async (flow_path) => ({
      dispatch_flow: await loadExecutableDispatchFlow(
        repo_directory,
        flow_path,
      ),
      flow_node: flow_nodes_by_path.get(flow_path) ?? null,
      flow_path,
    })),
  );
}

/**
 * @param {GraphNode} contract_node
 * @param {{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }} flow_candidate
 * @param {string} contract_path
 * @param {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} pending_assignments
 * @param {Set<string>} reserved_flow_instance_ids
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @returns {void}
 */
function collectFlowAssignments(
  contract_node,
  flow_candidate,
  contract_path,
  pending_assignments,
  reserved_flow_instance_ids,
  project_graph_result,
  graph_api,
) {
  const trigger_candidates = queryCandidateTasks(
    contract_node,
    flow_candidate.dispatch_flow.flow.trigger.query_text,
    project_graph_result,
    graph_api,
  );

  for (const trigger_node of trigger_candidates) {
    const trigger_binding = createTriggerBinding(trigger_node);
    const flow_instance_id = createFlowInstanceId(
      contract_path,
      flow_candidate.flow_path,
      flow_candidate.dispatch_flow.flow.trigger.binding_name,
      trigger_binding.id,
    );

    if (
      pending_assignments.has(flow_instance_id) ||
      reserved_flow_instance_ids.has(flow_instance_id)
    ) {
      continue;
    }

    pending_assignments.set(
      flow_instance_id,
      createPendingAssignment(
        contract_node,
        flow_candidate,
        trigger_binding,
        flow_instance_id,
        project_graph_result.graph,
      ),
    );
  }
}

/**
 * @param {GraphNode} contract_node
 * @param {string} contract_path
 * @param {Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }>} fallback_flow_candidates
 * @param {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} pending_assignments
 * @param {Set<string>} reserved_flow_instance_ids
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @returns {void}
 */
function collectFallbackAssignments(
  contract_node,
  contract_path,
  fallback_flow_candidates,
  pending_assignments,
  reserved_flow_instance_ids,
  project_graph_result,
  graph_api,
) {
  /** @type {Map<string, Array<{
   *   flow_candidate: {
   *     dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
   *     flow_node: GraphNode | null,
   *     flow_path: string,
   *   },
   *   trigger_binding: { id: string, path: string, status: string },
   * }>>} */
  const matches_by_task_id = new Map();

  for (const flow_candidate of fallback_flow_candidates) {
    const trigger_candidates = queryCandidateTasks(
      contract_node,
      flow_candidate.dispatch_flow.flow.trigger.query_text,
      project_graph_result,
      graph_api,
    );

    for (const trigger_node of trigger_candidates) {
      const trigger_binding = createTriggerBinding(trigger_node);
      const matches = matches_by_task_id.get(trigger_binding.id) ?? [];

      matches.push({
        flow_candidate,
        trigger_binding,
      });
      matches_by_task_id.set(trigger_binding.id, matches);
    }
  }

  for (const [task_id, matches] of matches_by_task_id.entries()) {
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous fallback flow match for task ${task_id} in ${contract_path}: ${matches
          .map(({ flow_candidate }) => flow_candidate.flow_path)
          .sort((left_path, right_path) =>
            left_path.localeCompare(right_path, 'en'),
          )
          .join(', ')}`,
      );
    }

    const [match] = matches;

    if (match === undefined) {
      continue;
    }

    const flow_instance_id = createFlowInstanceId(
      contract_path,
      match.flow_candidate.flow_path,
      match.flow_candidate.dispatch_flow.flow.trigger.binding_name,
      match.trigger_binding.id,
    );

    if (
      pending_assignments.has(flow_instance_id) ||
      reserved_flow_instance_ids.has(flow_instance_id)
    ) {
      continue;
    }

    pending_assignments.set(
      flow_instance_id,
      createPendingAssignment(
        contract_node,
        match.flow_candidate,
        match.trigger_binding,
        flow_instance_id,
        project_graph_result.graph,
      ),
    );
  }
}

/**
 * @param {GraphNode} trigger_node
 * @returns {{ id: string, path: string, status: string }}
 */
function createTriggerBinding(trigger_node) {
  return {
    id: readRequiredNodeId(trigger_node, 'trigger document'),
    path: readRequiredNodePath(trigger_node, 'trigger document'),
    status: readRequiredNodeStatus(trigger_node, 'trigger document'),
  };
}

/**
 * @param {GraphNode} contract_node
 * @param {{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }} flow_candidate
 * @param {{ id: string, path: string, status: string }} trigger_binding
 * @param {string} flow_instance_id
 * @param {ProjectGraphResult['graph']} graph
 * @returns {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>}
 */
function createPendingAssignment(
  contract_node,
  flow_candidate,
  trigger_binding,
  flow_instance_id,
  graph,
) {
  return {
    assignment_id: flow_instance_id,
    binding_targets: createDispatchBindingTargets(
      contract_node,
      flow_candidate.dispatch_flow.flow.trigger.binding_name,
      trigger_binding,
    ),
    contract_path: readRequiredNodePath(contract_node, 'dispatch contract'),
    decision_paths: collectRelatedPaths(contract_node, 'decided_by', graph),
    flow_id:
      flow_candidate.flow_node === null
        ? undefined
        : readRequiredNodeId(flow_candidate.flow_node, 'dispatch flow'),
    flow_instance_id,
    flow_path: flow_candidate.flow_path,
    ordered_jobs: flow_candidate.dispatch_flow.flow.ordered_jobs,
    start_job_name: flow_candidate.dispatch_flow.flow.start_job_name,
    task_id: createFlowInstanceTaskId(flow_instance_id),
    task_path: trigger_binding.path,
    type: 'assignment',
    workspace: flow_candidate.dispatch_flow.flow.workspace,
  };
}

/**
 * @param {ProjectGraphResult['graph']} graph
 * @returns {Map<string, GraphNode>}
 */
function createFlowNodesByPath(graph) {
  /** @type {Map<string, GraphNode>} */
  const flow_nodes_by_path = new Map();

  for (const graph_node of Object.values(graph.nodes)) {
    if (graph_node.$class !== 'flow' || typeof graph_node.$path !== 'string') {
      continue;
    }

    flow_nodes_by_path.set(graph_node.$path, graph_node);
  }

  return flow_nodes_by_path;
}

/**
 * @param {GraphNode} contract_node
 * @param {string} binding_name
 * @param {{ id: string, path: string, status: string }} binding_target
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function createDispatchBindingTargets(
  contract_node,
  binding_name,
  binding_target,
) {
  return {
    document: {
      id: readRequiredNodeId(contract_node, 'dispatch contract'),
      path: readRequiredNodePath(contract_node, 'dispatch contract'),
      status: readRequiredNodeStatus(contract_node, 'dispatch contract'),
    },
    [binding_name]: binding_target,
  };
}

/**
 * @param {Record<string, { id: string, path: string, status: string }>} binding_targets
 * @returns {[string, { id: string, path: string, status: string }]}
 */
function selectFlowInstanceBinding(binding_targets) {
  const flow_instance_bindings = Object.entries(binding_targets).filter(
    ([binding_name]) => binding_name !== 'document',
  );

  if (flow_instance_bindings.length !== 1) {
    throw new Error(
      `Expected exactly one non-document flow instance binding, found ${flow_instance_bindings.length}.`,
    );
  }

  return /** @type {[string, { id: string, path: string, status: string }]} */ (
    flow_instance_bindings[0]
  );
}

/**
 * @param {string} contract_path
 * @param {string} flow_path
 * @param {string} binding_name
 * @param {string} binding_target_id
 * @returns {string}
 */
function createFlowInstanceId(
  contract_path,
  flow_path,
  binding_name,
  binding_target_id,
) {
  const token = createHash('sha256')
    .update(
      `${contract_path}\n${flow_path}\n${binding_name}\n${binding_target_id}`,
    )
    .digest('hex')
    .slice(0, 16);

  return `flow-instance:${token}`;
}

/**
 * @param {string} flow_instance_id
 * @returns {string}
 */
function createFlowInstanceTaskId(flow_instance_id) {
  return flow_instance_id.replaceAll(/[^a-z0-9-]/giu, '-');
}

/**
 * @param {string} runtime_record_text
 * @returns {Record<string, unknown>}
 */
function parseRuntimeRecord(runtime_record_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(runtime_record_text));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected runtime record JSON to evaluate to an object.');
  }

  return /** @type {Record<string, unknown>} */ (parsed_value);
}
