/* eslint-disable max-lines */
/** @import { PatramBuildGraphResult } from 'patram' */
/** @import { BuildGraphResult, DiagnosticLike, GraphNode, OptionalGraphApi, QueryGraphApi } from './patram-types.ts' */
import { overlayGraph, queryGraph } from 'patram';

import { compileFlowQuery, createQueryBindings } from './flow-query.js';
import {
  getRuntimeRecordBindingTargets,
  getRuntimeRecordCompletedAt,
  getRuntimeRecordLeaseTime,
  getRuntimeRecordLocalOutcomeState,
  getRuntimeRecordSignals,
  getRuntimeRecordSelectedTaskId,
  getRuntimeRecordWorkerThreadId,
  getRuntimeRecordWorktreeIdentity,
  getRuntimeRecordWorktreeMode,
  getRuntimeRecordWorktreePath,
} from './runtime-record-model.js';

export { createMixedRuntimeGraph, evaluateMixedGraphQuery, resolveQueryGraph };

/**
 * @param {OptionalGraphApi | undefined} graph_api
 * @returns {QueryGraphApi}
 */
function resolveQueryGraph(graph_api) {
  return {
    query_graph:
      graph_api?.query_graph ??
      /** @type {QueryGraphApi['query_graph']} */ (queryGraph),
  };
}

/**
 * @param {BuildGraphResult} durable_graph
 * @param {{
 *   binding_targets: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   flow_id: string,
 *   runtime_records: Record<string, unknown>[],
 * }} options
 * @returns {BuildGraphResult}
 */
function createMixedRuntimeGraph(durable_graph, options) {
  const runtime_record = resolveCurrentRuntimeRecord(
    options.runtime_records,
    options.binding_targets,
  );

  if (runtime_record === null) {
    return durable_graph;
  }

  return /** @type {BuildGraphResult} */ (
    overlayGraph(
      /** @type {PatramBuildGraphResult} */ (durable_graph),
      /** @type {any} */ ({
        nodes: createRuntimeNodes(runtime_record, options),
      }),
    )
  );
}

/**
 * @param {BuildGraphResult} mixed_graph
 * @param {QueryGraphApi} graph_api
 * @param {string} query_text
 * @param {Record<string, string>} relation_bindings
 * @param {string[]} relation_names
 * @returns {boolean}
 */
function evaluateMixedGraphQuery(
  mixed_graph,
  graph_api,
  query_text,
  relation_bindings,
  relation_names,
) {
  void relation_names;

  const query_result = graph_api.query_graph(
    mixed_graph,
    compileFlowQuery(query_text),
    createQueryBindings(relation_bindings),
  );

  if (query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(query_result.diagnostics));
  }

  return query_result.nodes.length > 0;
}

/**
 * @param {DiagnosticLike[]} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.path ?? diagnostic.file_path ?? '<unknown>'}: ${diagnostic.message}`,
    )
    .join('\n');
}

/**
 * @param {Record<string, unknown>[]} runtime_records
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {Record<string, unknown> | null}
 */
function resolveCurrentRuntimeRecord(runtime_records, binding_targets) {
  const matching_records = runtime_records.filter((runtime_record) =>
    matchesBindingTargets(runtime_record, binding_targets),
  );

  if (matching_records.length === 0) {
    return null;
  }

  const active_records = matching_records.filter(
    (runtime_record) =>
      getRuntimeRecordLocalOutcomeState(runtime_record) === 'unresolved',
  );

  if (active_records.length > 1) {
    throw new Error(
      'Expected at most one active runtime record for the current run.',
    );
  }

  if (active_records.length === 1) {
    return active_records[0];
  }

  return resolveCurrentTerminalRuntimeRecord(matching_records);
}

/**
 * @param {Record<string, unknown> | null} runtime_record
 * @param {{
 *   binding_targets: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   flow_id: string,
 * }} options
 * @returns {Record<string, GraphNode>}
 */
function createRuntimeNodes(runtime_record, options) {
  /** @type {Record<string, GraphNode>} */
  const runtime_nodes = {};

  if (runtime_record === null) {
    return runtime_nodes;
  }

  const local_outcome_state = getRuntimeRecordLocalOutcomeState(runtime_record);
  const subject = readRuntimeSubject(options.binding_targets);

  runtime_nodes['runtime:$flow_instance:current'] = createFlowInstanceNode(
    runtime_record,
    options.binding_targets,
    options.flow_id,
    local_outcome_state,
  );

  if (local_outcome_state === 'unresolved') {
    Object.assign(runtime_nodes, createPluginSignalNodes(runtime_record));
    Object.assign(
      runtime_nodes,
      createActiveRuntimeNodes(runtime_record, subject),
    );

    return runtime_nodes;
  }

  Object.assign(runtime_nodes, createPluginSignalNodes(runtime_record));
  runtime_nodes['runtime:$signal:worker_completed'] = createTerminalSignalNode(
    runtime_record,
    local_outcome_state,
    subject,
  );

  return runtime_nodes;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @param {string} flow_id
 * @param {string} local_outcome_state
 * @returns {GraphNode}
 */
function createFlowInstanceNode(
  runtime_record,
  binding_targets,
  flow_id,
  local_outcome_state,
) {
  return {
    $class: '$flow_instance',
    $id: '$flow_instance:current',
    flow_document: flow_id,
    id: 'runtime:$flow_instance:current',
    retained_until_cleanup: true,
    root_document: resolveRootDocumentId(runtime_record, binding_targets),
    state: local_outcome_state === 'unresolved' ? 'active' : 'completed',
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {'document' | 'task'} subject
 * @returns {Record<string, GraphNode>}
 */
function createActiveRuntimeNodes(runtime_record, subject) {
  /** @type {Record<string, GraphNode>} */
  const runtime_nodes = {
    'runtime:$lease:current': {
      $class: '$lease',
      $id: '$lease:current',
      id: 'runtime:$lease:current',
      leased_at: getRuntimeRecordLeaseTime(runtime_record),
      owner: 'pravaha',
      state: 'held',
      subject,
    },
  };
  const worktree_path = getRuntimeRecordWorktreePath(runtime_record);

  runtime_nodes['runtime:$worker:current'] = {
    $class: '$worker',
    $id: '$worker:current',
    backend: 'codex-sdk',
    id: 'runtime:$worker:current',
    state: 'running',
    subject,
    thread_id: getRuntimeRecordWorkerThreadId(runtime_record),
    worktree: worktree_path,
  };

  if (typeof worktree_path !== 'string') {
    return runtime_nodes;
  }

  runtime_nodes['runtime:$worktree:current'] = {
    $class: '$worktree',
    $id: '$worktree:current',
    id: 'runtime:$worktree:current',
    mode: getRuntimeRecordWorktreeMode(runtime_record) ?? 'named',
    name:
      getRuntimeRecordWorktreeIdentity(runtime_record) ??
      getRuntimeRecordSelectedTaskId(runtime_record) ??
      'current',
    path: worktree_path,
    state: 'prepared',
  };

  return runtime_nodes;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {string} local_outcome_state
 * @param {'document' | 'task'} subject
 * @returns {GraphNode}
 */
function createTerminalSignalNode(
  runtime_record,
  local_outcome_state,
  subject,
) {
  return {
    $class: '$signal',
    $id: '$signal:worker_completed',
    emitted_at: getRuntimeRecordCompletedAt(runtime_record),
    id: 'runtime:$signal:worker_completed',
    kind: 'worker_completed',
    outcome: local_outcome_state,
    retained_until_cleanup: true,
    subject,
  };
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {Record<string, GraphNode>}
 */
function createPluginSignalNodes(runtime_record) {
  /** @type {Record<string, GraphNode>} */
  const signal_nodes = {};

  getRuntimeRecordSignals(runtime_record).forEach((runtime_signal, index) => {
    signal_nodes[`runtime:$signal:${runtime_signal.kind}:${index}`] = {
      ...spreadSignalPayload(runtime_signal.payload),
      $class: '$signal',
      $id: `$signal:${runtime_signal.kind}:${index}`,
      emitted_at: runtime_signal.emitted_at,
      id: `runtime:$signal:${runtime_signal.kind}:${index}`,
      kind: runtime_signal.kind,
      payload: runtime_signal.payload,
      subject: runtime_signal.subject,
    };
  });

  return signal_nodes;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function spreadSignalPayload(payload) {
  /** @type {Record<string, unknown>} */
  const payload_fields = {};

  for (const [field_name, field_value] of Object.entries(payload)) {
    if (
      field_name === '$class' ||
      field_name === '$id' ||
      field_name === 'emitted_at' ||
      field_name === 'id' ||
      field_name === 'kind' ||
      field_name === 'payload' ||
      field_name === 'subject'
    ) {
      continue;
    }

    payload_fields[field_name] = field_value;
  }

  return payload_fields;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {boolean}
 */
function matchesBindingTargets(runtime_record, binding_targets) {
  const runtime_binding_targets =
    getRuntimeRecordBindingTargets(runtime_record);

  if (binding_targets.task !== undefined) {
    if (runtime_binding_targets?.task?.id === binding_targets.task.id) {
      return matchesDocumentBinding(
        runtime_binding_targets,
        binding_targets.document,
      );
    }

    return (
      `task:${getRuntimeRecordSelectedTaskId(runtime_record)}` ===
        binding_targets.task.id &&
      matchesDocumentBinding(runtime_binding_targets, binding_targets.document)
    );
  }

  if (binding_targets.document !== undefined) {
    return (
      runtime_binding_targets?.document?.id === binding_targets.document.id
    );
  }

  return false;
}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * } | null} runtime_binding_targets
 * @param {{ id: string, path: string, status: string } | undefined} document_binding
 * @returns {boolean}
 */
function matchesDocumentBinding(runtime_binding_targets, document_binding) {
  if (document_binding === undefined) {
    return true;
  }

  if (runtime_binding_targets?.document === undefined) {
    return true;
  }

  return runtime_binding_targets.document.id === document_binding.id;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {string}
 */
function resolveRootDocumentId(runtime_record, binding_targets) {
  if (binding_targets.document !== undefined) {
    return binding_targets.document.id;
  }

  const runtime_binding_targets =
    getRuntimeRecordBindingTargets(runtime_record);

  if (runtime_binding_targets?.document !== undefined) {
    return runtime_binding_targets.document.id;
  }

  return 'document';
}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {'document' | 'task'}
 */
function readRuntimeSubject(binding_targets) {
  if (binding_targets.task !== undefined) {
    return 'task';
  }

  return 'document';
}

/**
 * @param {Record<string, unknown>[]} runtime_records
 * @returns {Record<string, unknown> | null}
 */
function resolveCurrentTerminalRuntimeRecord(runtime_records) {
  if (runtime_records.length === 0) {
    return null;
  }

  if (runtime_records.length === 1) {
    return runtime_records[0];
  }

  const ordered_records = runtime_records
    .map((runtime_record) => ({
      runtime_record,
      snapshot_time:
        getRuntimeRecordCompletedAt(runtime_record) ??
        getRuntimeRecordLeaseTime(runtime_record),
    }))
    .sort((left_record, right_record) =>
      compareSnapshotTimes(
        right_record.snapshot_time,
        left_record.snapshot_time,
      ),
    );

  if (ordered_records[0]?.snapshot_time === null) {
    throw new Error(
      'Expected exactly one current retained terminal runtime record for the current run.',
    );
  }

  if (ordered_records[1]?.snapshot_time === ordered_records[0].snapshot_time) {
    throw new Error(
      'Expected exactly one current retained terminal runtime record for the current run.',
    );
  }

  return ordered_records[0].runtime_record;
}

/**
 * @param {string | null} left_snapshot_time
 * @param {string | null} right_snapshot_time
 * @returns {number}
 */
function compareSnapshotTimes(left_snapshot_time, right_snapshot_time) {
  if (left_snapshot_time === right_snapshot_time) {
    return 0;
  }

  if (left_snapshot_time === null) {
    return -1;
  }

  if (right_snapshot_time === null) {
    return 1;
  }

  return left_snapshot_time.localeCompare(right_snapshot_time);
}
