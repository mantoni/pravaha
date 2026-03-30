/** @import { BuildGraphResult, GraphNode, QueryGraphApi } from '../../shared/types/patram-types.ts' */
import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { createStateMachineResumeAttemptContext } from './runtime-attempt-records.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createConcreteWorkspaceDefinition,
  prepareWorkspace,
} from '../workspaces/runtime-files.js';

export { createResumedAttempt };

const RESUME_RUNTIME_LABEL = 'Resumed runtime';

/**
 * @param {string} repo_directory
 * @param {{
 *   durable_graph?: BuildGraphResult,
 *   graph_api?: QueryGraphApi,
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }} options
 * @returns {Promise<{
 *   attempt_context: ReturnType<typeof createStateMachineResumeAttemptContext> & {
 *     prompt: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   ordered_jobs: Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'],
 * }>}
 */
async function createResumedAttempt(repo_directory, options) {
  const graph_api = resolveGraphApi(options.graph_api);
  const durable_graph =
    options.durable_graph ??
    (await graph_api.load_project_graph(repo_directory)).graph;
  const durable_attempt_context = createStateMachineResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );
  const state_machine_flow = await loadStateMachineFlow(
    repo_directory,
    durable_attempt_context.flow_path,
  );
  const refreshed_binding_targets = refreshBindingTargets(
    durable_graph,
    durable_attempt_context.binding_targets,
  );
  const decision_paths = collectDecisionPaths(
    durable_graph,
    durable_attempt_context.contract_path,
  );
  const resume_workspace = await resolveResumeWorkspaceDefinition(
    repo_directory,
    state_machine_flow.workspace,
    durable_attempt_context.recorded_worktree,
  );
  const worktree_assignment = await prepareWorkspace(
    repo_directory,
    resume_workspace,
  );

  return {
    attempt_context: {
      ...durable_attempt_context,
      binding_targets: refreshed_binding_targets,
      prompt: await createRuntimePrompt(repo_directory, {
        contract_path: durable_attempt_context.contract_path,
        decision_paths,
        flow_path: durable_attempt_context.flow_path,
        runtime_label: RESUME_RUNTIME_LABEL,
        task_path: durable_attempt_context.task_path,
      }),
      worktree_assignment,
      worktree_path: worktree_assignment.path,
    },
    ordered_jobs: state_machine_flow.ordered_jobs,
  };
}

/**
 * @param {string} repo_directory
 * @param {Awaited<ReturnType<typeof loadStateMachineFlow>>['workspace']} workspace
 * @param {{
 *   identity: string,
 *   mode: 'ephemeral' | 'named' | 'pooled',
 *   path: string,
 *   slot?: string,
 * } | undefined} recorded_worktree
 * @returns {Promise<{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral' | 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }>}
 */
async function resolveResumeWorkspaceDefinition(
  repo_directory,
  workspace,
  recorded_worktree,
) {
  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(
      pravaha_config_result.diagnostics
        .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
        .join('\n'),
    );
  }

  const workspace_definition =
    pravaha_config_result.config.workspace_config[workspace.id];

  if (workspace_definition === undefined) {
    throw new Error(
      `Flow workspace.id "${workspace.id}" is not defined in pravaha.json workspaces.`,
    );
  }

  if (typeof recorded_worktree?.path === 'string') {
    return createConcreteWorkspaceDefinition(
      workspace.id,
      workspace_definition,
      recorded_worktree.path,
    );
  }

  throw new Error(
    'Expected a resumed runtime record to include the selected workspace path.',
  );
}

/**
 * @param {BuildGraphResult} durable_graph
 * @param {Record<
 *   string,
 *   { id: string, path: string, status: string } | undefined
 * >} binding_targets
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function refreshBindingTargets(durable_graph, binding_targets) {
  /** @type {Record<string, { id: string, path: string, status: string }>} */
  const refreshed_targets = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    if (binding_target === undefined) {
      continue;
    }

    refreshed_targets[binding_name] = readCurrentBindingTarget(
      durable_graph,
      binding_target,
    );
  }

  return refreshed_targets;
}

/**
 * @param {BuildGraphResult} durable_graph
 * @param {{ id: string, path: string, status: string }} binding_target
 * @returns {{ id: string, path: string, status: string }}
 */
function readCurrentBindingTarget(durable_graph, binding_target) {
  const matching_node = findGraphNodeByIdentity(
    durable_graph,
    binding_target.id,
    binding_target.path,
  );

  if (matching_node === null) {
    throw new Error(
      `Expected runtime binding ${binding_target.id} (${binding_target.path}) to exist in the current project graph.`,
    );
  }

  if (
    typeof matching_node.$id !== 'string' ||
    typeof matching_node.$path !== 'string'
  ) {
    throw new Error(
      `Expected runtime binding ${binding_target.id} (${binding_target.path}) to expose graph identity and path.`,
    );
  }

  return {
    id: matching_node.$id,
    path: matching_node.$path,
    status:
      typeof matching_node.status === 'string'
        ? matching_node.status
        : binding_target.status,
  };
}

/**
 * @param {BuildGraphResult} durable_graph
 * @param {string} contract_path
 * @returns {string[]}
 */
function collectDecisionPaths(durable_graph, contract_path) {
  const contract_node = Object.values(durable_graph.nodes).find(
    (node) => node.$path === contract_path,
  );

  if (contract_node?.$id === undefined) {
    return [];
  }

  /** @type {string[]} */
  const decision_paths = [];

  for (const edge of durable_graph.edges) {
    if (edge.from !== contract_node.$id || edge.relation !== 'decided_by') {
      continue;
    }

    const related_node = durable_graph.nodes[edge.to];

    if (typeof related_node?.$path === 'string') {
      decision_paths.push(related_node.$path);
    }
  }

  decision_paths.sort((left_path, right_path) =>
    left_path.localeCompare(right_path, 'en'),
  );

  return decision_paths;
}

/**
 * @param {BuildGraphResult} durable_graph
 * @param {string} node_id
 * @param {string} node_path
 * @returns {GraphNode | null}
 */
function findGraphNodeByIdentity(durable_graph, node_id, node_path) {
  for (const node of Object.values(durable_graph.nodes)) {
    if (node.$id === node_id || node.$path === node_path) {
      return node;
    }
  }

  return null;
}
