/* eslint-disable complexity, max-lines, max-lines-per-function */
/** @import * as $k$$l$protocol$k$js from './protocol.js'; */
/** @import { GraphApi, GraphNode, OptionalGraphApi, ProjectGraphResult } from '../../shared/types/patram-types.ts' */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { globby } from 'globby';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import {
  formatDiagnostics,
  readRequiredNodeId,
  readRequiredNodePath,
  readRequiredNodeStatus,
} from './context.js';
import {
  collectOccupiedWorktreeIdentities,
  selectDispatchWorkspace,
} from './assignments.js';
import { loadDispatchFlowCandidates } from './dispatch-flows.js';
import {
  createFlowInstanceId,
  readRuntimeRecordFlowInstanceId,
} from './flow-instance.js';
import {
  collectRelatedPaths,
  queryOwnerDocuments,
  resolveRelatedNodes,
} from './graph.js';
import {
  listTerminalRuntimeRecords,
  listUnresolvedRuntimeRecords,
} from '../records/runtime-records.js';

export { createAdHocDispatchAssignment };

/**
 * @typedef {{ id: string, path: string, status: string }} BindingTarget
 */

/**
 * @typedef {Awaited<ReturnType<typeof loadDispatchFlowCandidates>>[number]} DispatchFlowCandidate
 */

/**
 * @typedef {Extract<$k$$l$protocol$k$js.LocalDispatchMessage, { type: 'assignment' }>} AssignmentMessage
 */

/**
 * @typedef {{
 *   binding_targets: Record<string, BindingTarget>,
 *   flow_candidate: DispatchFlowCandidate,
 *   owner_node: GraphNode | null,
 * }} AdHocFlowSelection
 */

/**
 * @param {string} repo_directory
 * @param {{
 *   file_path?: string,
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   prompt_text?: string,
 * }} options
 * @returns {Promise<AssignmentMessage>}
 */
async function createAdHocDispatchAssignment(repo_directory, options) {
  const graph_api = resolveGraphApi(options.graph_api);
  const input_mode = readInputMode(options);
  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(pravaha_config_result.diagnostics));
  }

  const flow_candidates = await loadDispatchFlowCandidates(
    repo_directory,
    pravaha_config_result.config.flow_config.matches,
  );
  const project_graph_result =
    await graph_api.load_project_graph(repo_directory);
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);
  const terminal_runtime_records =
    await listTerminalRuntimeRecords(repo_directory);
  const used_flow_instance_ids = collectUsedFlowInstanceIds(
    unresolved_runtime_records,
    terminal_runtime_records,
  );
  const occupied_worktree_identities = collectOccupiedWorktreeIdentities(
    unresolved_runtime_records,
  );
  const flow_instance_id = createFlowInstanceId(used_flow_instance_ids);
  /** @type {AdHocFlowSelection} */
  const selected_flow =
    input_mode.kind === 'file'
      ? await selectFileDispatchFlow(
          repo_directory,
          input_mode.file_path,
          flow_candidates,
          graph_api,
          project_graph_result,
        )
      : selectPromptDispatchFlow(flow_candidates);
  const selected_workspace = selectDispatchWorkspace(
    repo_directory,
    selected_flow.flow_candidate.dispatch_flow.flow.workspace,
    pravaha_config_result.config.workspace_config,
    flow_instance_id,
    occupied_worktree_identities,
  );

  if (selected_workspace === null) {
    throw new Error(
      `Workspace "${selected_flow.flow_candidate.dispatch_flow.flow.workspace}" is not available for ${selected_flow.flow_candidate.flow_path}.`,
    );
  }

  const task_id = createAdHocTaskId(flow_instance_id);
  const task_path =
    input_mode.kind === 'file'
      ? input_mode.file_path
      : await writePromptInputFile(
          repo_directory,
          flow_instance_id,
          input_mode.prompt_text,
        );
  const prompt_context =
    selected_flow.owner_node === null
      ? {
          contract_path: selected_flow.flow_candidate.flow_path,
          decision_paths: [],
        }
      : resolveOwnerPromptContext(
          selected_flow.owner_node,
          project_graph_result.graph,
          selected_flow.flow_candidate.flow_path,
        );
  /** @type {AssignmentMessage} */
  const assignment = {
    assignment_id: flow_instance_id,
    binding_targets: selected_flow.binding_targets,
    contract_path: prompt_context.contract_path,
    decision_paths: prompt_context.decision_paths,
    flow_instance_id,
    flow_path: selected_flow.flow_candidate.flow_path,
    task_id,
    task_path,
    type: 'assignment',
    workspace: selected_workspace.workspace,
  };

  if (input_mode.kind === 'prompt') {
    assignment.input = {
      kind: 'prompt',
      prompt: input_mode.prompt_text,
    };
  }

  return assignment;
}

/**
 * @param {{
 *   file_path?: string,
 *   prompt_text?: string,
 * }} options
 * @returns {{
 *   file_path: string,
 *   kind: 'file',
 * } | {
 *   kind: 'prompt',
 *   prompt_text: string,
 * }}
 */
function readInputMode(options) {
  if (
    typeof options.file_path === 'string' &&
    typeof options.prompt_text === 'string'
  ) {
    throw new Error('Expected exactly one ad hoc dispatch input.');
  }

  if (typeof options.file_path === 'string') {
    return {
      file_path: options.file_path,
      kind: 'file',
    };
  }

  if (typeof options.prompt_text === 'string') {
    return {
      kind: 'prompt',
      prompt_text: options.prompt_text,
    };
  }

  throw new Error('Expected exactly one ad hoc dispatch input.');
}

/**
 * @param {string} repo_directory
 * @param {string} file_path
 * @param {DispatchFlowCandidate[]} flow_candidates
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @param {ProjectGraphResult} project_graph_result
 * @returns {Promise<AdHocFlowSelection>}
 */
async function selectFileDispatchFlow(
  repo_directory,
  file_path,
  flow_candidates,
  graph_api,
  project_graph_result,
) {
  const normalized_file_path = await normalizeInputFilePath(
    repo_directory,
    file_path,
  );
  /** @type {DispatchFlowCandidate[]} */
  const matching_flow_candidates = [];

  for (const flow_candidate of flow_candidates) {
    if (
      typeof flow_candidate.dispatch_flow.flow.trigger.file_glob !== 'string'
    ) {
      continue;
    }

    if (
      await matchesFileTrigger(
        repo_directory,
        normalized_file_path,
        flow_candidate.dispatch_flow.flow.trigger.file_glob,
      )
    ) {
      matching_flow_candidates.push(flow_candidate);
    }
  }

  if (matching_flow_candidates.length === 0) {
    throw new Error(
      `No file-dispatch flow matches ${normalized_file_path}; refusing to dispatch.`,
    );
  }

  if (matching_flow_candidates.length > 1) {
    throw new Error(
      'Multiple file-dispatch flows match the supplied input; refusing to dispatch.',
    );
  }

  const [flow_candidate] = matching_flow_candidates;

  if (flow_candidate === undefined) {
    throw new Error('Expected one file-dispatch flow candidate.');
  }

  const matched_owner_node = resolveMatchedOwnerNode(
    normalized_file_path,
    flow_candidate,
    graph_api,
    project_graph_result,
  );

  if (
    typeof flow_candidate.dispatch_flow.flow.trigger.query_text === 'string' &&
    matched_owner_node === null
  ) {
    throw new Error(
      `Flow ${flow_candidate.flow_path} matched ${normalized_file_path} through flow.on.file but the file does not satisfy flow.on.patram.`,
    );
  }

  return {
    binding_targets: {
      doc:
        matched_owner_node === null
          ? createSyntheticFileBinding(normalized_file_path)
          : createOwnerBinding(matched_owner_node),
    },
    flow_candidate,
    owner_node:
      matched_owner_node ??
      findGraphNodeByPath(project_graph_result, normalized_file_path),
  };
}

/**
 * @param {DispatchFlowCandidate[]} flow_candidates
 * @returns {AdHocFlowSelection}
 */
function selectPromptDispatchFlow(flow_candidates) {
  const matching_flow_candidates = flow_candidates.filter(
    (flow_candidate) =>
      flow_candidate.dispatch_flow.flow.trigger.prompt_enabled,
  );

  if (matching_flow_candidates.length === 0) {
    throw new Error(
      'No prompt-dispatch flow matches the supplied input; refusing to dispatch.',
    );
  }

  if (matching_flow_candidates.length > 1) {
    throw new Error(
      'Multiple prompt-dispatch flows match the supplied input; refusing to dispatch.',
    );
  }

  const [flow_candidate] = matching_flow_candidates;

  if (flow_candidate === undefined) {
    throw new Error('Expected one prompt-dispatch flow candidate.');
  }

  if (
    typeof flow_candidate.dispatch_flow.flow.trigger.query_text === 'string'
  ) {
    throw new Error(
      `Flow ${flow_candidate.flow_path} cannot accept --prompt because it defines flow.on.patram.`,
    );
  }

  return {
    binding_targets: {},
    flow_candidate,
    owner_node: null,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} file_path
 * @returns {Promise<string>}
 */
async function normalizeInputFilePath(repo_directory, file_path) {
  const resolved_repo_directory = resolve(repo_directory);
  const resolved_file_path = resolve(repo_directory, file_path);
  const repo_relative_path = relative(
    resolved_repo_directory,
    resolved_file_path,
  ).replaceAll('\\', '/');

  if (
    repo_relative_path === '' ||
    repo_relative_path.startsWith('../') ||
    repo_relative_path === '..'
  ) {
    throw new Error(`Expected ${file_path} to resolve inside the repository.`);
  }

  await stat(resolved_file_path);

  return repo_relative_path;
}

/**
 * @param {string} repo_directory
 * @param {string} file_path
 * @param {string} file_glob
 * @returns {Promise<boolean>}
 */
async function matchesFileTrigger(repo_directory, file_path, file_glob) {
  const matched_paths = await globby([file_glob], {
    cwd: repo_directory,
    expandDirectories: false,
    gitignore: true,
    onlyFiles: true,
  });

  return matched_paths.includes(file_path);
}

/**
 * @param {string} file_path
 * @param {DispatchFlowCandidate} flow_candidate
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @param {ProjectGraphResult} project_graph_result
 * @returns {GraphNode | null}
 */
function resolveMatchedOwnerNode(
  file_path,
  flow_candidate,
  graph_api,
  project_graph_result,
) {
  if (
    typeof flow_candidate.dispatch_flow.flow.trigger.query_text !== 'string'
  ) {
    return findGraphNodeByPath(project_graph_result, file_path);
  }

  return (
    queryOwnerDocuments(
      flow_candidate.dispatch_flow.flow.trigger.query_text,
      project_graph_result,
      graph_api,
    ).find(
      (owner_node) =>
        readRequiredNodePath(owner_node, 'dispatch owner') === file_path,
    ) ?? null
  );
}

/**
 * @param {ProjectGraphResult} project_graph_result
 * @param {string} file_path
 * @returns {GraphNode | null}
 */
function findGraphNodeByPath(project_graph_result, file_path) {
  const graph_nodes = /** @type {GraphNode[]} */ (
    Object.values(project_graph_result.graph.nodes)
  );

  for (const graph_node of graph_nodes) {
    if (graph_node.$path === file_path) {
      return graph_node;
    }
  }

  return null;
}

/**
 * @param {GraphNode} owner_node
 * @returns {{ id: string, path: string, status: string }}
 */
function createOwnerBinding(owner_node) {
  return {
    id: readRequiredNodeId(owner_node, 'dispatch owner'),
    path: readRequiredNodePath(owner_node, 'dispatch owner'),
    status: readRequiredNodeStatus(owner_node, 'dispatch owner'),
  };
}

/**
 * @param {string} file_path
 * @returns {{ id: string, path: string, status: string }}
 */
function createSyntheticFileBinding(file_path) {
  return {
    id: `file:${file_path}`,
    path: file_path,
    status: 'manual',
  };
}

/**
 * @param {Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>} unresolved_runtime_records
 * @param {Array<{
 *   record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }>} terminal_runtime_records
 * @returns {Set<string>}
 */
function collectUsedFlowInstanceIds(
  unresolved_runtime_records,
  terminal_runtime_records,
) {
  /** @type {Set<string>} */
  const used_flow_instance_ids = new Set();

  for (const runtime_record of [
    ...unresolved_runtime_records,
    ...terminal_runtime_records,
  ]) {
    const flow_instance_id = readRuntimeRecordFlowInstanceId(
      runtime_record.record,
    );

    if (typeof flow_instance_id === 'string') {
      used_flow_instance_ids.add(flow_instance_id);
    }
  }

  return used_flow_instance_ids;
}

/**
 * @param {string} flow_instance_id
 * @returns {string}
 */
function createAdHocTaskId(flow_instance_id) {
  return `dispatch-${flow_instance_id}`;
}

/**
 * @param {string} repo_directory
 * @param {string} flow_instance_id
 * @param {string} prompt_text
 * @returns {Promise<string>}
 */
async function writePromptInputFile(
  repo_directory,
  flow_instance_id,
  prompt_text,
) {
  const repo_path = join(
    '.pravaha',
    'dispatch-inputs',
    `${createAdHocTaskId(flow_instance_id)}.md`,
  );
  const absolute_path = join(repo_directory, repo_path);

  await mkdir(dirname(absolute_path), { recursive: true });
  await writeFile(absolute_path, `${prompt_text}\n`);

  return repo_path;
}

/**
 * @param {GraphNode} owner_node
 * @param {ProjectGraphResult['graph']} graph
 * @param {string} fallback_contract_path
 * @returns {{ contract_path: string, decision_paths: string[] }}
 */
function resolveOwnerPromptContext(owner_node, graph, fallback_contract_path) {
  const contract_node =
    owner_node.$class === 'contract'
      ? owner_node
      : resolveRelatedNodes(owner_node, 'tracked_in', graph).find(
          (tracked_node) => tracked_node.$class === 'contract',
        );

  if (contract_node === undefined) {
    return {
      contract_path: fallback_contract_path,
      decision_paths: collectRelatedPaths(owner_node, 'decided_by', graph),
    };
  }

  return {
    contract_path: readRequiredNodePath(contract_node, 'dispatch contract'),
    decision_paths: collectRelatedPaths(contract_node, 'decided_by', graph),
  };
}
