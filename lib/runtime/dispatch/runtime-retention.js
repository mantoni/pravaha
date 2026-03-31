/**
 * @import { GraphApi, OptionalGraphApi, ProjectGraphResult } from '../../shared/types/patram-types.ts'
 */
import { rm } from 'node:fs/promises';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { getRuntimeRecordCompletedAt } from '../records/runtime-record-model.js';
import { listTerminalRuntimeRecords } from '../records/runtime-records.js';
import {
  createFlowMatchIdentity,
  readRuntimeRecordFlowMatchIdentity,
} from './flow-instance.js';
import { queryOwnerDocuments } from './graph.js';
import { loadDispatchFlowCandidates } from './dispatch-flows.js';

export { cleanupExpiredTerminalRuntimeRecords };

const FLOW_INSTANCE_RETENTION_MS = 72 * 60 * 60 * 1000;

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 * }} [options]
 * @returns {Promise<void>}
 */
async function cleanupExpiredTerminalRuntimeRecords(
  repo_directory,
  options = {},
) {
  const now = options.now ?? (() => new Date());
  const terminal_runtime_records =
    await listTerminalRuntimeRecords(repo_directory);
  const expired_runtime_records = terminal_runtime_records.filter(
    (runtime_record) =>
      isExpiredTerminalRuntimeRecord(runtime_record.record, now),
  );

  if (expired_runtime_records.length === 0) {
    return;
  }

  const current_match_identities = await loadCurrentMatchIdentitiesIfAvailable(
    repo_directory,
    options.graph_api,
  );

  if (current_match_identities === null) {
    return;
  }

  for (const expired_runtime_record of expired_runtime_records) {
    const match_identity = readRuntimeRecordFlowMatchIdentity(
      expired_runtime_record.record,
    );

    if (
      match_identity === null ||
      current_match_identities.has(match_identity)
    ) {
      continue;
    }

    await rm(expired_runtime_record.runtime_record_path, { force: true });
  }
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {() => Date} now
 * @returns {boolean}
 */
function isExpiredTerminalRuntimeRecord(runtime_record, now) {
  const completed_at = getRuntimeRecordCompletedAt(runtime_record);

  if (typeof completed_at !== 'string') {
    return false;
  }

  const completed_at_value = Date.parse(completed_at);

  if (Number.isNaN(completed_at_value)) {
    return false;
  }

  return now().getTime() - completed_at_value >= FLOW_INSTANCE_RETENTION_MS;
}

/**
 * @param {string} repo_directory
 * @param {OptionalGraphApi | undefined} graph_api
 * @returns {Promise<Set<string> | null>}
 */
async function loadCurrentMatchIdentitiesIfAvailable(
  repo_directory,
  graph_api,
) {
  const resolved_graph_api = resolveGraphApi(graph_api);
  /** @type {ProjectGraphResult} */
  let project_graph_result;

  try {
    project_graph_result =
      await resolved_graph_api.load_project_graph(repo_directory);
  } catch {
    return null;
  }

  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (
    pravaha_config_result.diagnostics.length > 0 ||
    project_graph_result.diagnostics.length > 0
  ) {
    return null;
  }

  const dispatch_flow_candidates = await loadDispatchFlowCandidates(
    repo_directory,
    pravaha_config_result.config.flow_config.matches,
  );

  return collectCurrentMatchIdentities(
    dispatch_flow_candidates,
    project_graph_result,
    resolved_graph_api,
  );
}

/**
 * @param {Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadDispatchFlowCandidates>>[number]['dispatch_flow'],
 *   flow_path: string,
 * }>} dispatch_flow_candidates
 * @param {ProjectGraphResult} project_graph_result
 * @param {{ query_graph: GraphApi['query_graph'] }} graph_api
 * @returns {Set<string>}
 */
function collectCurrentMatchIdentities(
  dispatch_flow_candidates,
  project_graph_result,
  graph_api,
) {
  /** @type {Set<string>} */
  const current_match_identities = new Set();

  for (const flow_candidate of dispatch_flow_candidates) {
    const owner_nodes = queryOwnerDocuments(
      flow_candidate.dispatch_flow.flow.trigger.query_text,
      project_graph_result,
      graph_api,
    );

    for (const owner_node of owner_nodes) {
      const owner_id = readOwnerId(owner_node);

      current_match_identities.add(
        createFlowMatchIdentity(flow_candidate.flow_path, owner_id),
      );
    }
  }

  return current_match_identities;
}

/**
 * @param {ProjectGraphResult['graph']['nodes'][string]} owner_node
 * @returns {string}
 */
function readOwnerId(owner_node) {
  if (typeof owner_node.$id === 'string') {
    return owner_node.$id;
  }

  if (typeof owner_node.id === 'string') {
    return owner_node.id;
  }

  throw new Error('Expected a matched owner document to expose an id.');
}
