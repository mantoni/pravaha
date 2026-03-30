/** @import { GraphApi, GraphNode, ProjectGraphResult } from '../../shared/types/patram-types.ts' */
/* eslint-disable complexity, max-lines, max-lines-per-function, jsdoc/prefer-import-tag */
import { readFile } from 'node:fs/promises';

import { globby } from 'globby';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { loadExecutableDispatchFlow } from '../../flow/reconcile-flow.js';
import {
  collectRelatedPaths,
  queryOwnerDocuments,
  resolveRelatedNodes,
} from './graph.js';
import {
  getRuntimeRecordApproval,
  getRuntimeRecordFlowPath,
  getRuntimeRecordQueueWait,
  getRuntimeRecordWorktreeIdentity,
} from '../records/runtime-record-model.js';
import {
  createFlowInstanceId,
  readRuntimeRecordFlowInstanceId,
} from './flow-instance.js';
import {
  listTerminalRuntimeRecords,
  listUnresolvedRuntimeRecords,
} from '../records/runtime-records.js';
import {
  createConcreteWorkspaceDefinition,
  readReusableWorkspaceIdentities,
} from '../workspaces/runtime-files.js';
import {
  resumeTaskAttempt,
  runStateMachineAttempt,
} from '../attempts/state-machine.js';
import {
  DISPATCH_RUNTIME_LABEL,
  formatDiagnostics,
  readAssignmentExecutionContext,
  readRequiredNodeId,
  readRequiredNodeClass,
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
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   worker_error: string | null,
 * }>}
 */
async function executeAssignedFlowInstance(assignment, shared_context) {
  const execution_context = readAssignmentExecutionContext(shared_context);
  let run_result;

  if (typeof assignment.resume_runtime_record_path === 'string') {
    const runtime_record = parseRuntimeRecord(
      await readFile(assignment.resume_runtime_record_path, 'utf8'),
    );
    const project_graph_result =
      await execution_context.graph_api.load_project_graph(
        execution_context.repo_directory,
      );

    run_result = await resumeTaskAttempt(execution_context.repo_directory, {
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
  } else if (
    Array.isArray(assignment.ordered_jobs) &&
    typeof assignment.start_job_name === 'string' &&
    assignment.workspace !== undefined &&
    assignment.binding_targets !== undefined &&
    typeof assignment.contract_path === 'string' &&
    typeof assignment.flow_path === 'string' &&
    typeof assignment.task_id === 'string' &&
    typeof assignment.task_path === 'string'
  ) {
    run_result = await runStateMachineAttempt(
      execution_context.repo_directory,
      {
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
      },
    );
  } else {
    throw new Error(
      `Assignment ${assignment.assignment_id} is missing required state-machine execution fields.`,
    );
  }

  await warnIfFlowInstanceStillMatchesAfterTerminalOutcome(
    assignment.flow_instance_id,
    run_result,
    shared_context,
  );

  return run_result;
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
 * @param {{
 *   explicit_flow_instance_ids?: Set<string>,
 *   selected_flow_instance_ids?: Set<string>,
 *   warn_on_completed_matches?: boolean,
 * }} [options]
 * @returns {Promise<Array<Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>>}
 */
async function materializePendingAssignments(shared_context, options = {}) {
  /** @type {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} */
  const pending_assignments = new Map();
  /** @type {Set<string>} */
  const reserved_flow_instance_ids = new Set();
  /** @type {Set<string>} */
  const completed_flow_instance_ids = new Set();
  /** @type {Set<string>} */
  const warned_completed_flow_instance_ids = new Set();
  const unresolved_runtime_records = await listUnresolvedRuntimeRecords(
    shared_context.repo_directory,
  );
  const occupied_worktree_identities = await collectOccupiedWorktreeIdentities(
    shared_context.repo_directory,
    unresolved_runtime_records,
  );
  const terminal_runtime_records = await listTerminalRuntimeRecords(
    shared_context.repo_directory,
  );

  for (const terminal_runtime_record of terminal_runtime_records) {
    const completed_flow_instance_id = readRuntimeRecordFlowInstanceId(
      terminal_runtime_record.record,
    );

    if (typeof completed_flow_instance_id === 'string') {
      completed_flow_instance_ids.add(completed_flow_instance_id);
    }
  }

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

  const dispatch_flow_candidates = await loadDispatchFlowCandidates(
    shared_context.repo_directory,
    project_graph_result,
    pravaha_config_result.config.flow_config.default_matches,
  );

  collectGlobalAssignments(
    dispatch_flow_candidates,
    pending_assignments,
    reserved_flow_instance_ids,
    completed_flow_instance_ids,
    occupied_worktree_identities,
    project_graph_result,
    shared_context.graph_api,
    shared_context.log_to_operator,
    options,
    warned_completed_flow_instance_ids,
  );

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
  const queue_wait = getRuntimeRecordQueueWait(
    unresolved_runtime_record.record,
  );

  if (approval?.approved_at === null || queue_wait?.state === 'waiting') {
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
 * @param {string} repo_directory
 * @param {ProjectGraphResult} project_graph_result
 * @param {string[]} default_matches
 * @returns {Promise<Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }>>}
 */
async function loadDispatchFlowCandidates(
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
 * @param {Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }>} dispatch_flow_candidates
 * @param {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} pending_assignments
 * @param {Set<string>} reserved_flow_instance_ids
 * @param {Set<string>} completed_flow_instance_ids
 * @param {Set<string>} occupied_worktree_identities
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @param {(line: string) => void} log_to_operator
 * @param {{
 *   explicit_flow_instance_ids?: Set<string>,
 *   selected_flow_instance_ids?: Set<string>,
 *   warn_on_completed_matches?: boolean,
 * }} options
 * @param {Set<string>} warned_completed_flow_instance_ids
 * @returns {void}
 */
function collectGlobalAssignments(
  dispatch_flow_candidates,
  pending_assignments,
  reserved_flow_instance_ids,
  completed_flow_instance_ids,
  occupied_worktree_identities,
  project_graph_result,
  graph_api,
  log_to_operator,
  options,
  warned_completed_flow_instance_ids,
) {
  /** @type {Map<string, Array<{
   *   flow_candidate: {
   *     dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
   *     flow_node: GraphNode | null,
   *     flow_path: string,
   *   },
   *   owner_binding: { id: string, path: string, status: string },
   *   owner_node: GraphNode,
   * }>>} */
  const matches_by_owner_id = new Map();

  for (const flow_candidate of dispatch_flow_candidates) {
    const owner_nodes = queryOwnerDocuments(
      flow_candidate.dispatch_flow.flow.trigger.query_text,
      project_graph_result,
      graph_api,
    );

    for (const owner_node of owner_nodes) {
      const owner_binding = createTriggerBinding(owner_node);
      const matches = matches_by_owner_id.get(owner_binding.id) ?? [];

      matches.push({
        flow_candidate,
        owner_binding,
        owner_node,
      });
      matches_by_owner_id.set(owner_binding.id, matches);
    }
  }

  for (const [owner_id, matches] of matches_by_owner_id.entries()) {
    const matching_flow_paths = [
      ...new Set(matches.map(({ flow_candidate }) => flow_candidate.flow_path)),
    ].sort((left_path, right_path) =>
      left_path.localeCompare(right_path, 'en'),
    );

    if (matching_flow_paths.length > 1) {
      const [first_match] = matches;
      const owner_path =
        first_match === undefined
          ? owner_id
          : readRequiredNodePath(first_match.owner_node, 'flow owner');

      log_to_operator(
        `Multiple dispatch flows match owner ${owner_id} (${owner_path}); skipping local scheduling for that document. Matching flows: ${matching_flow_paths.join(', ')}`,
      );
      continue;
    }

    const [match] = matches;

    if (match === undefined) {
      continue;
    }

    const selected_workspace = selectDispatchWorkspace(
      match.flow_candidate.dispatch_flow.flow.workspace,
      occupied_worktree_identities,
    );

    if (selected_workspace === null) {
      continue;
    }

    const flow_instance_id = createFlowInstanceId(
      match.flow_candidate.flow_path,
      match.owner_binding.id,
    );

    if (
      shouldIgnoreFlowInstance(
        flow_instance_id,
        selected_workspace.worktree_identity,
        pending_assignments,
        reserved_flow_instance_ids,
        completed_flow_instance_ids,
        occupied_worktree_identities,
        log_to_operator,
        options,
        warned_completed_flow_instance_ids,
      )
    ) {
      continue;
    }

    pending_assignments.set(
      flow_instance_id,
      createPendingAssignment(
        match.owner_node,
        match.flow_candidate,
        match.owner_binding,
        flow_instance_id,
        project_graph_result.graph,
        selected_workspace.workspace,
      ),
    );

    if (selected_workspace.worktree_identity !== null) {
      occupied_worktree_identities.add(selected_workspace.worktree_identity);
    }
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
 * @param {GraphNode} owner_node
 * @param {{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_node: GraphNode | null,
 *   flow_path: string,
 * }} flow_candidate
 * @param {{ id: string, path: string, status: string }} owner_binding
 * @param {string} flow_instance_id
 * @param {ProjectGraphResult['graph']} graph
 * @param {{
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   source: {
 *     id: string,
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }} workspace
 * @returns {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>}
 */
function createPendingAssignment(
  owner_node,
  flow_candidate,
  owner_binding,
  flow_instance_id,
  graph,
  workspace,
) {
  const prompt_context = resolveOwnerPromptContext(owner_node, graph);

  return {
    assignment_id: flow_instance_id,
    binding_targets: createDispatchBindingTargets(
      readRequiredNodeClass(owner_node, 'flow owner'),
      owner_binding,
    ),
    contract_path: prompt_context.contract_path,
    decision_paths: prompt_context.decision_paths,
    flow_id:
      flow_candidate.flow_node === null
        ? undefined
        : readRequiredNodeId(flow_candidate.flow_node, 'dispatch flow'),
    flow_instance_id,
    flow_path: flow_candidate.flow_path,
    ordered_jobs: flow_candidate.dispatch_flow.flow.ordered_jobs,
    start_job_name: flow_candidate.dispatch_flow.flow.start_job_name,
    task_id: createFlowInstanceTaskId(flow_instance_id),
    task_path: owner_binding.path,
    type: 'assignment',
    workspace,
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
 * @param {string} binding_name
 * @param {{ id: string, path: string, status: string }} binding_target
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function createDispatchBindingTargets(binding_name, binding_target) {
  return {
    [binding_name]: binding_target,
  };
}

/**
 * @param {GraphNode} owner_node
 * @param {ProjectGraphResult['graph']} graph
 * @returns {{ contract_path?: string, decision_paths: string[] }}
 */
function resolveOwnerPromptContext(owner_node, graph) {
  const contract_node =
    owner_node.$class === 'contract'
      ? owner_node
      : resolveRelatedNodes(owner_node, 'tracked_in', graph).find(
          (tracked_node) => tracked_node.$class === 'contract',
        );

  if (contract_node === undefined) {
    return {
      decision_paths: collectRelatedPaths(owner_node, 'decided_by', graph),
    };
  }

  return {
    contract_path: readRequiredNodePath(contract_node, 'dispatch contract'),
    decision_paths: collectRelatedPaths(contract_node, 'decided_by', graph),
  };
}

/**
 * @param {string} flow_instance_id
 * @returns {string}
 */
function createFlowInstanceTaskId(flow_instance_id) {
  return flow_instance_id.replaceAll(/[^a-z0-9-]/giu, '-');
}

/**
 * @param {Awaited<ReturnType<typeof loadExecutableDispatchFlow>>['flow']['workspace']} workspace_definition
 * @param {Set<string>} occupied_worktree_identities
 * @returns {{
 *   workspace: {
 *     materialize: {
 *       kind: 'worktree',
 *       mode: 'ephemeral' | 'pooled',
 *       ref: string,
 *     },
 *     source: {
 *       id: string,
 *       kind: 'repo',
 *     },
 *     type: 'git.workspace',
 *   },
 *   worktree_identity: string | null,
 * } | null}
 */
function selectDispatchWorkspace(
  workspace_definition,
  occupied_worktree_identities,
) {
  for (const source_id of workspace_definition.source.ids) {
    const workspace = createConcreteWorkspaceDefinition(
      workspace_definition,
      source_id,
    );
    const [worktree_identity] = readReusableWorkspaceIdentities(workspace);

    if (
      worktree_identity !== undefined &&
      occupied_worktree_identities.has(worktree_identity)
    ) {
      continue;
    }

    return {
      workspace,
      worktree_identity: worktree_identity ?? null,
    };
  }

  return null;
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

/**
 * @param {string} flow_instance_id
 * @param {string | null} worktree_identity
 * @param {Map<string, Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>>} pending_assignments
 * @param {Set<string>} reserved_flow_instance_ids
 * @param {Set<string>} completed_flow_instance_ids
 * @param {Set<string>} occupied_worktree_identities
 * @param {(line: string) => void} log_to_operator
 * @param {{
 *   explicit_flow_instance_ids?: Set<string>,
 *   selected_flow_instance_ids?: Set<string>,
 *   warn_on_completed_matches?: boolean,
 * }} options
 * @param {Set<string>} warned_completed_flow_instance_ids
 * @returns {boolean}
 */
function shouldIgnoreFlowInstance(
  flow_instance_id,
  worktree_identity,
  pending_assignments,
  reserved_flow_instance_ids,
  completed_flow_instance_ids,
  occupied_worktree_identities,
  log_to_operator,
  options,
  warned_completed_flow_instance_ids,
) {
  if (options.selected_flow_instance_ids?.has(flow_instance_id) === false) {
    return true;
  }

  if (
    pending_assignments.has(flow_instance_id) ||
    reserved_flow_instance_ids.has(flow_instance_id)
  ) {
    return true;
  }

  if (
    worktree_identity !== null &&
    occupied_worktree_identities.has(worktree_identity)
  ) {
    return true;
  }

  if (
    completed_flow_instance_ids.has(flow_instance_id) &&
    options.explicit_flow_instance_ids?.has(flow_instance_id) !== true
  ) {
    if (
      options.warn_on_completed_matches !== false &&
      !warned_completed_flow_instance_ids.has(flow_instance_id)
    ) {
      warned_completed_flow_instance_ids.add(flow_instance_id);
      log_to_operator(
        `Matching flow instance ${flow_instance_id} already reached a terminal runtime outcome; ignoring it during dispatch. Use pravaha dispatch --flow ${flow_instance_id} to rerun explicitly.`,
      );
    }

    return true;
  }

  return false;
}

/**
 * @param {string} repo_directory
 * @param {Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>} unresolved_runtime_records
 * @returns {Promise<Set<string>>}
 */
async function collectOccupiedWorktreeIdentities(
  repo_directory,
  unresolved_runtime_records,
) {
  /** @type {Set<string>} */
  const occupied_worktree_identities = new Set();
  /** @type {Map<string, Awaited<ReturnType<typeof loadExecutableDispatchFlow>>>} */
  const flow_cache = new Map();

  for (const unresolved_runtime_record of unresolved_runtime_records) {
    const worktree_identity = await readRuntimeRecordWorktreeIdentity(
      repo_directory,
      unresolved_runtime_record.record,
      flow_cache,
    );

    if (worktree_identity !== null) {
      occupied_worktree_identities.add(worktree_identity);
    }
  }

  return occupied_worktree_identities;
}

/**
 * @param {string} repo_directory
 * @param {Record<string, unknown>} runtime_record
 * @param {Map<string, Awaited<ReturnType<typeof loadExecutableDispatchFlow>>>} flow_cache
 * @returns {Promise<string | null>}
 */
async function readRuntimeRecordWorktreeIdentity(
  repo_directory,
  runtime_record,
  flow_cache,
) {
  const recorded_identity = getRuntimeRecordWorktreeIdentity(runtime_record);

  if (typeof recorded_identity === 'string') {
    return recorded_identity;
  }

  const flow_path = getRuntimeRecordFlowPath(runtime_record);

  if (typeof flow_path !== 'string') {
    return null;
  }

  let dispatch_flow = flow_cache.get(flow_path);

  if (dispatch_flow === undefined) {
    dispatch_flow = await loadExecutableDispatchFlow(repo_directory, flow_path);
    flow_cache.set(flow_path, dispatch_flow);
  }

  const [worktree_identity] = readReusableWorkspaceIdentities(
    createConcreteWorkspaceDefinition(
      dispatch_flow.flow.workspace,
      dispatch_flow.flow.workspace.source.ids[0],
    ),
  );

  return worktree_identity ?? null;
}

/**
 * @param {string} flow_instance_id
 * @param {Awaited<ReturnType<typeof runStateMachineAttempt>> | Awaited<ReturnType<typeof resumeTaskAttempt>>} run_result
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
 * @returns {Promise<void>}
 */
async function warnIfFlowInstanceStillMatchesAfterTerminalOutcome(
  flow_instance_id,
  run_result,
  shared_context,
) {
  if (run_result.outcome === 'pending-approval') {
    return;
  }

  const matching_assignments = await materializePendingAssignments(
    /** @type {any} */ (shared_context),
    {
      explicit_flow_instance_ids: new Set([flow_instance_id]),
      selected_flow_instance_ids: new Set([flow_instance_id]),
      warn_on_completed_matches: false,
    },
  );

  if (
    !matching_assignments.some(
      (assignment) => assignment.flow_instance_id === flow_instance_id,
    )
  ) {
    return;
  }

  shared_context.log_to_operator(
    `Flow instance ${flow_instance_id} still matches after terminal outcome; default dispatch will ignore it because it already reached a terminal runtime outcome. Use pravaha dispatch --flow ${flow_instance_id} to rerun explicitly.`,
  );
}
