/** @import { BuildGraphResult, GraphNode } from '../../shared/types/patram-types.ts' */
import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { createConcreteWorkspaceDefinition } from '../workspaces/runtime-files.js';

export {
  collectDecisionPaths,
  refreshBindingTargets,
  resolveResumeWorkspaceDefinition,
};

/**
 * @param {string} repo_directory
 * @param {string} workspace
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
    pravaha_config_result.config.workspace_config[workspace];

  if (workspace_definition === undefined) {
    throw new Error(
      `Flow workspace "${workspace}" is not defined in pravaha.json workspaces.`,
    );
  }

  if (typeof recorded_worktree?.path === 'string') {
    return createConcreteWorkspaceDefinition(
      workspace,
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
