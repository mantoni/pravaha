/**
 * @import { Server } from 'node:net';
 * @import { RunResult, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
 * @import { GraphApi, GraphNode, OptionalGraphApi, ProjectGraphResult } from './patram-types.ts';
 */
/* eslint-disable complexity, max-lines, max-lines-per-function */
/**
 * Local worker-pool runtime with dispatcher election over machine-local IPC.
 *
 * Decided by: ../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Implements: ../docs/contracts/runtime/local-dispatch-runtime.md
 * @patram
 */
import { createServer } from 'node:net';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  canConnectToDispatcher,
  closeServer,
  createProtocolConnection,
  isAddressInUseError,
  isInitialProbeDisconnect,
  openProtocolConnection,
  removeStaleUnixSocket,
  reportOperatorError,
  resolveDispatchEndpoint,
  waitForMessage,
} from './local-dispatch-protocol.js';
import { loadDispatchFlow } from './reconcile-flow.js';
import {
  collectRelatedPaths,
  evaluateGraphCondition,
  queryCandidateTasks,
  resolveGraphApi,
  resolveSingleRelatedNode,
} from './reconcile-graph.js';
import {
  getRuntimeRecordApproval,
  getRuntimeRecordBindingTargets,
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
} from './runtime-record-model.js';
import { listUnresolvedRuntimeRecords } from './runtime-records.js';
import { resumeTaskAttempt, runTaskAttempt } from './runtime-attempt.js';

export {
  createWorkerSignalContext,
  dispatch,
  handleDispatcherFollowerMessage,
  handleFollowerMessage,
  startWorkerSession,
  tryListen,
  worker,
};
/**
 * @typedef {
 *   | {
 *       assignment_id: string,
 *       await_query?: string,
 *       binding_targets?: Record<
 *         string,
 *         { id: string, path: string, status: string } | undefined
 *       >,
 *       contract_path?: string,
 *       decision_paths?: string[],
 *       flow_id?: string,
 *       flow_instance_id: string,
 *       flow_path?: string,
 *       ordered_steps?: Array<
 *         | { command_text: string, kind: 'run' }
 *         | { kind: 'uses', step_name: string, with_value?: unknown }
 *       >,
 *       resume_runtime_record_path?: string,
 *       task_id?: string,
 *       task_path?: string,
 *       transition_conditions?: { failure: string, success: string },
 *       transition_target_bindings?: { failure: string, success: string },
 *       transition_targets?: { failure: string, success: string },
 *       type: 'assignment',
 *       worktree_policy?:
 *         | { mode: 'ephemeral' }
 *         | { mode: 'named', slot: string },
 *     }
 *   | { assignment_id: string, type: 'assignment_completed', worker_id: string }
 *   | { assignment_id: string, error: string, type: 'assignment_failed', worker_id: string }
 *   | { dispatcher_id: string, type: 'dispatch_notified' }
 *   | { source: string, type: 'notify_dispatch' }
 *   | { type: 'register_worker', worker_id: string }
 *   | { dispatcher_id: string, type: 'worker_registered' }
 * } LocalDispatchMessage
 */
/**
 * @typedef {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<LocalDispatchMessage>,
 *   send: (message: LocalDispatchMessage) => void,
 *   setMessageHandler: (
 *     message_handler: (message: LocalDispatchMessage) => void | Promise<void>,
 *   ) => void,
 *   wait_until_closed: () => Promise<void>,
 * }} ProtocolConnection
 */
/**
 * @typedef {{
 *   id: string | null,
 *   run: (input: string, turn_options?: TurnOptions) => Promise<RunResult>,
 * }} WorkerThread
 */
/**
 * @typedef {{
 *   resumeThread?: (id: string, thread_options?: ThreadOptions) => WorkerThread,
 *   startThread: (thread_options?: ThreadOptions) => WorkerThread,
 * }} WorkerClient
 */
/**
 * @typedef {{ query_graph: GraphApi['query_graph'] }} DispatchGraphApi
 */
/**
 * @typedef {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api: ReturnType<typeof resolveGraphApi>,
 *   log_to_operator: (line: string) => void,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: WorkerClient,
 * }} SharedSessionContext
 */

const DISPATCH_RUNTIME_LABEL = 'Pravaha local dispatch runtime slice';
const SUPPORTED_DISPATCH_CONTRACT_STATUSES = [
  'proposed',
  'active',
  'blocked',
  'review',
];

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   signal?: AbortSignal,
 *   worker_id?: string,
 *   worker_client?: WorkerClient,
 * }} [options]
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   outcome: 'stopped',
 *   role: 'dispatcher' | 'follower',
 *   worker_id: string,
 * }>}
 */
async function worker(repo_directory, options = {}) {
  const signal_context = createWorkerSignalContext(options.signal);
  const worker_session = await startWorkerSession(repo_directory, {
    graph_api: options.graph_api,
    now: options.now,
    operator_io: options.operator_io,
    signal: signal_context.signal,
    worker_id: options.worker_id,
    worker_client: options.worker_client,
  });

  try {
    await worker_session.wait_until_stopped();
  } finally {
    await signal_context.cleanup();
  }

  return {
    dispatcher_id: worker_session.dispatcher_id,
    endpoint: worker_session.endpoint,
    outcome: 'stopped',
    role: worker_session.role,
    worker_id: worker_session.worker_id,
  };
}

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   on_event?: (event: Record<string, unknown>) => void | Promise<void>,
 *   platform?: NodeJS.Platform,
 *   signal?: AbortSignal,
 *   worker_id?: string,
 *   worker_client?: WorkerClient,
 * }} [options]
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   role: 'dispatcher' | 'follower',
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 *   worker_id: string,
 * }>}
 */
async function startWorkerSession(repo_directory, options = {}) {
  const worker_id = options.worker_id ?? createWorkerId();
  const endpoint = await resolveDispatchEndpoint(
    repo_directory,
    options.platform ?? process.platform,
  );
  const shared_context = createSharedSessionContext(
    endpoint.address,
    options.on_event,
    options.operator_io,
    options.signal,
    worker_id,
    resolveGraphApi(options.graph_api),
    repo_directory,
    options.worker_client,
    options.now ?? createCurrentDate,
  );

  return (
    (await startDispatcherSession(endpoint, shared_context)) ??
    startFollowerSession(endpoint, shared_context)
  );
}

/**
 * @param {string} repo_directory
 * @param {{
 *   platform?: NodeJS.Platform,
 * }} [options]
 * @returns {Promise<{
 *   dispatcher_available: boolean,
 *   dispatcher_id: string | null,
 *   endpoint: string,
 *   notification_delivered: boolean,
 *   outcome: 'success',
 * }>}
 */
async function dispatch(repo_directory, options = {}) {
  const endpoint = await resolveDispatchEndpoint(
    repo_directory,
    options.platform ?? process.platform,
  );
  const protocol_connection = await openProtocolConnection(endpoint.address);

  if (protocol_connection === null) {
    return createDispatchResult(endpoint.address, null);
  }

  try {
    protocol_connection.send({
      source: 'dispatch-cli',
      type: 'notify_dispatch',
    });

    const response_message = await waitForMessage(
      protocol_connection,
      'Expected the dispatcher to acknowledge notify delivery.',
    );

    if (response_message.type !== 'dispatch_notified') {
      throw new Error(
        `Expected dispatch_notified, received ${response_message.type}.`,
      );
    }

    protocol_connection.close();
    await protocol_connection.wait_until_closed();

    return createDispatchResult(
      endpoint.address,
      response_message.dispatcher_id,
    );
  } finally {
    protocol_connection.destroy();
  }
}

/**
 * @param {{
 *   address: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }} endpoint
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   role: 'dispatcher',
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 *   worker_id: string,
 * } | null>}
 */
async function startDispatcherSession(endpoint, shared_context) {
  if (await canConnectToDispatcher(endpoint.address)) {
    return null;
  }

  if (endpoint.kind === 'unix-socket') {
    await removeStaleUnixSocket(endpoint.address);
  }

  const dispatcher_server = createServer();
  /** @type {Map<string, ProtocolConnection>} */
  const follower_connections = new Map();
  const dispatcher_state = createDispatcherState(
    follower_connections,
    shared_context,
  );
  const stop_context = createStopContext();

  dispatcher_server.on('connection', (socket) => {
    const protocol_connection = createProtocolConnection(socket);

    void handleDispatcherConnection(
      dispatcher_state,
      follower_connections,
      protocol_connection,
      shared_context,
    ).catch((error) => {
      reportOperatorError(shared_context.operator_io, error);
    });
  });

  if (!(await tryListen(dispatcher_server, endpoint.address))) {
    return null;
  }

  await announceWorkerStart(
    shared_context,
    'dispatcher',
    shared_context.worker_id,
  );
  requestDispatcherScheduling(dispatcher_state, shared_context);
  registerAbort(shared_context.signal, () =>
    stopDispatcherSession(
      dispatcher_state,
      dispatcher_server,
      endpoint,
      follower_connections,
      stop_context,
    ),
  );

  return {
    dispatcher_id: shared_context.worker_id,
    endpoint: endpoint.address,
    role: 'dispatcher',
    stop() {
      return stopDispatcherSession(
        dispatcher_state,
        dispatcher_server,
        endpoint,
        follower_connections,
        stop_context,
      );
    },
    wait_until_stopped() {
      return stop_context.stopped;
    },
    worker_id: shared_context.worker_id,
  };
}

/**
 * @param {{
 *   address: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }} endpoint
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   role: 'follower',
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 *   worker_id: string,
 * }>}
 */
async function startFollowerSession(endpoint, shared_context) {
  const protocol_connection = await openProtocolConnection(endpoint.address);

  if (protocol_connection === null) {
    throw new Error(
      'Expected a live dispatcher to accept follower registration.',
    );
  }

  const stop_context = createStopContext();
  protocol_connection.wait_until_closed().then(() => {
    if (!stop_context.stopped_requested) {
      shared_context.log_to_operator(
        `[worker ${shared_context.worker_id} follower] dispatcher connection closed`,
      );
    }
    stop_context.resolve();
  });
  protocol_connection.send({
    type: 'register_worker',
    worker_id: shared_context.worker_id,
  });

  const registration_message = await waitForMessage(
    protocol_connection,
    'Expected the dispatcher to acknowledge worker registration.',
  );

  if (registration_message.type !== 'worker_registered') {
    throw new Error(
      `Expected worker_registered, received ${registration_message.type}.`,
    );
  }

  protocol_connection.setMessageHandler((message) =>
    handleFollowerMessage(message, shared_context, protocol_connection),
  );
  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} follower] connected to dispatcher ${registration_message.dispatcher_id}`,
  );
  await announceWorkerStart(
    shared_context,
    'follower',
    registration_message.dispatcher_id,
  );
  registerAbort(shared_context.signal, () =>
    stopFollowerSession(protocol_connection, stop_context),
  );

  return {
    dispatcher_id: registration_message.dispatcher_id,
    endpoint: endpoint.address,
    role: 'follower',
    stop() {
      return stopFollowerSession(protocol_connection, stop_context);
    },
    wait_until_stopped() {
      return stop_context.stopped;
    },
    worker_id: shared_context.worker_id,
  };
}

/**
 * @param {{
 *   active_assignments: Map<
 *     string,
 *     { flow_instance_id: string, worker_id: string }
 *   >,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatcherConnection(
  dispatcher_state,
  follower_connections,
  protocol_connection,
  shared_context,
) {
  try {
    const first_message = await waitForMessage(
      protocol_connection,
      'Expected the client to send an initial local dispatch message.',
    );

    if (first_message.type === 'notify_dispatch') {
      await handleDispatchNotification(
        dispatcher_state,
        first_message,
        protocol_connection,
        shared_context,
      );

      return;
    }

    if (first_message.type !== 'register_worker') {
      throw new Error(
        `Expected register_worker or notify_dispatch, received ${first_message.type}.`,
      );
    }

    await registerFollower(
      dispatcher_state,
      follower_connections,
      first_message.worker_id,
      protocol_connection,
      shared_context,
    );
  } catch (error) {
    if (isInitialProbeDisconnect(error)) {
      protocol_connection.destroy();

      return;
    }

    protocol_connection.destroy(error);
    throw error;
  }
}

/**
 * @param {string} endpoint
 * @param {string | null} dispatcher_id
 * @returns {{ dispatcher_available: boolean, dispatcher_id: string | null, endpoint: string, notification_delivered: boolean, outcome: 'success' }}
 */
function createDispatchResult(endpoint, dispatcher_id) {
  return {
    dispatcher_available: dispatcher_id !== null,
    dispatcher_id,
    endpoint,
    notification_delivered: dispatcher_id !== null,
    outcome: 'success',
  };
}

/**
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @param {'dispatcher' | 'follower'} role
 * @param {string} dispatcher_id
 * @returns {Promise<void>}
 */
async function announceWorkerStart(shared_context, role, dispatcher_id) {
  if (role === 'dispatcher') {
    shared_context.log_to_operator(
      `[worker ${shared_context.worker_id} dispatcher] leadership acquired; listening on ${shared_context.endpoint}; authoritative rescan scheduled`,
    );
  }

  await shared_context.emit_event({
    dispatcher_id,
    endpoint: shared_context.endpoint,
    kind: 'worker_started',
    role,
    worker_id: shared_context.worker_id,
  });
}

/**
 * @param {{
 *   active_assignments: Map<
 *     string,
 *     { flow_instance_id: string, worker_id: string }
 *   >,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {Server} dispatcher_server
 * @param {{
 *   address: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }} endpoint
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {ReturnType<typeof createStopContext>} stop_context
 * @returns {Promise<void>}
 */
async function stopDispatcherSession(
  dispatcher_state,
  dispatcher_server,
  endpoint,
  follower_connections,
  stop_context,
) {
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;
  dispatcher_state.scheduling_requested = false;

  for (const follower_connection of follower_connections.values()) {
    follower_connection.close();
    follower_connection.destroy();
  }

  await closeServer(dispatcher_server);

  if (endpoint.kind === 'unix-socket') {
    await removeStaleUnixSocket(endpoint.address);
  }

  stop_context.resolve();

  return stop_context.stopped;
}

/**
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createStopContext>} stop_context
 * @returns {Promise<void>}
 */
async function stopFollowerSession(protocol_connection, stop_context) {
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;
  protocol_connection.close();
  protocol_connection.destroy();
  await protocol_connection.wait_until_closed();
  stop_context.resolve();

  return stop_context.stopped;
}

/**
 * @param {Server} dispatcher_server
 * @param {string} endpoint_address
 * @returns {Promise<boolean>}
 */
async function tryListen(dispatcher_server, endpoint_address) {
  try {
    await new Promise((resolve_listen, reject_listen) => {
      dispatcher_server.once('error', reject_listen);
      dispatcher_server.listen(endpoint_address, () => {
        dispatcher_server.off('error', reject_listen);
        resolve_listen(undefined);
      });
    });

    return true;
  } catch (error) {
    if (isAddressInUseError(error)) {
      return false;
    }

    throw error;
  }
}

/**
 * @param {{
 *   active_assignments: Map<
 *     string,
 *     { flow_instance_id: string, worker_id: string }
 *   >,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {{ source: string, type: 'notify_dispatch' }} notification_message
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatchNotification(
  dispatcher_state,
  notification_message,
  protocol_connection,
  shared_context,
) {
  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} dispatcher] notify received from ${notification_message.source}`,
  );
  await shared_context.emit_event({
    dispatcher_id: shared_context.worker_id,
    kind: 'dispatch_notified',
    source: notification_message.source,
  });
  protocol_connection.send({
    dispatcher_id: shared_context.worker_id,
    type: 'dispatch_notified',
  });
  protocol_connection.close();
  requestDispatcherScheduling(dispatcher_state, shared_context);
}

/**
 * @param {{
 *   active_assignments: Map<
 *     string,
 *     { flow_instance_id: string, worker_id: string }
 *   >,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {string} follower_id
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function registerFollower(
  dispatcher_state,
  follower_connections,
  follower_id,
  protocol_connection,
  shared_context,
) {
  follower_connections.set(follower_id, protocol_connection);
  dispatcher_state.workers.set(follower_id, {
    kind: 'follower',
    protocol_connection,
    state: 'ready',
  });
  protocol_connection.send({
    dispatcher_id: shared_context.worker_id,
    type: 'worker_registered',
  });
  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} dispatcher] follower registered: ${follower_id}`,
  );
  await shared_context.emit_event({
    dispatcher_id: shared_context.worker_id,
    kind: 'follower_registered',
    worker_id: follower_id,
  });
  protocol_connection.setMessageHandler((message) =>
    handleDispatcherFollowerMessage(message, shared_context, dispatcher_state),
  );
  requestDispatcherScheduling(dispatcher_state, shared_context);
  await protocol_connection.wait_until_closed();
  follower_connections.delete(follower_id);
  dispatcher_state.workers.delete(follower_id);
  const released_assignment_count = releaseWorkerAssignments(
    dispatcher_state,
    follower_id,
  );
  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} dispatcher] follower disconnected: ${follower_id}; released ${released_assignment_count} assignment${pluralize(released_assignment_count)} for reassignment`,
  );
  await shared_context.emit_event({
    kind: 'follower_disconnected',
    released_assignment_count,
    worker_id: follower_id,
  });
  requestDispatcherScheduling(dispatcher_state, shared_context);
}

/**
 * @param {LocalDispatchMessage} message
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: ReturnType<typeof resolveGraphApi>,
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
 * @param {ProtocolConnection | undefined} [protocol_connection]
 * @returns {Promise<void>}
 */
async function handleFollowerMessage(
  message,
  shared_context,
  protocol_connection,
) {
  if (message.type !== 'assignment') {
    throw new Error(`Unexpected follower message ${message.type}.`);
  }

  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} follower] assigned ${message.flow_instance_id} (${message.assignment_id})`,
  );
  await shared_context.emit_event({
    assignment_id: message.assignment_id,
    flow_instance_id: message.flow_instance_id,
    kind: 'assignment_received',
    worker_id: shared_context.worker_id,
  });

  if (protocol_connection === undefined) {
    return;
  }

  try {
    const run_result = await executeAssignedFlowInstance(
      message,
      shared_context,
    );

    if (run_result.outcome === 'failure') {
      protocol_connection.send({
        assignment_id: message.assignment_id,
        error: run_result.worker_error ?? 'Assignment failed.',
        type: 'assignment_failed',
        worker_id: shared_context.worker_id,
      });

      return;
    }

    protocol_connection.send({
      assignment_id: message.assignment_id,
      type: 'assignment_completed',
      worker_id: shared_context.worker_id,
    });
  } catch (error) {
    protocol_connection.send({
      assignment_id: message.assignment_id,
      error: readErrorMessage(error),
      type: 'assignment_failed',
      worker_id: shared_context.worker_id,
    });
  }
}

/**
 * @param {LocalDispatchMessage} message
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   log_to_operator: (line: string) => void,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   signal?: AbortSignal,
 *   worker_id: string,
 * }} shared_context
 * @param {{
 *   active_assignments: Map<
 *     string,
 *     { flow_instance_id: string, worker_id: string }
 *   >,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * } | undefined} [dispatcher_state]
 * @returns {Promise<void>}
 */
async function handleDispatcherFollowerMessage(
  message,
  shared_context,
  dispatcher_state,
) {
  if (message.type === 'assignment_completed') {
    shared_context.log_to_operator(
      `[worker ${shared_context.worker_id} dispatcher] assignment completed ${message.assignment_id} on ${message.worker_id}`,
    );
    await shared_context.emit_event({
      assignment_id: message.assignment_id,
      kind: 'assignment_completed',
      worker_id: message.worker_id,
    });
    markWorkerReady(dispatcher_state, message.assignment_id, message.worker_id);
    requestDispatcherScheduling(
      dispatcher_state,
      /** @type {any} */ (shared_context),
    );

    return;
  }

  if (message.type === 'assignment_failed') {
    shared_context.log_to_operator(
      `[worker ${shared_context.worker_id} dispatcher] assignment failed ${message.assignment_id} on ${message.worker_id}: ${message.error}`,
    );
    await shared_context.emit_event({
      assignment_id: message.assignment_id,
      error: message.error,
      kind: 'assignment_failed',
      worker_id: message.worker_id,
    });
    markWorkerReady(dispatcher_state, message.assignment_id, message.worker_id);
    requestDispatcherScheduling(
      dispatcher_state,
      /** @type {any} */ (shared_context),
    );

    return;
  }

  throw new Error(`Unexpected dispatcher message ${message.type}.`);
}

/**
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }}
 */
function createDispatcherState(follower_connections, shared_context) {
  return {
    active_assignments: new Map(),
    follower_connections,
    scheduling_requested: false,
    scheduling_running: false,
    workers: new Map([
      [
        shared_context.worker_id,
        {
          kind: 'dispatcher',
          state: 'ready',
        },
      ],
    ]),
  };
}

/**
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * } | undefined} dispatcher_state
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {void}
 */
function requestDispatcherScheduling(dispatcher_state, shared_context) {
  if (dispatcher_state === undefined) {
    return;
  }

  dispatcher_state.scheduling_requested = true;

  if (dispatcher_state.scheduling_running) {
    return;
  }

  dispatcher_state.scheduling_running = true;

  void runDispatcherScheduling(dispatcher_state, shared_context)
    .catch((error) => {
      reportOperatorError(shared_context.operator_io, error);
    })
    .finally(() => {
      dispatcher_state.scheduling_running = false;

      if (dispatcher_state.scheduling_requested) {
        requestDispatcherScheduling(dispatcher_state, shared_context);
      }
    });
}

/**
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function runDispatcherScheduling(dispatcher_state, shared_context) {
  while (dispatcher_state.scheduling_requested) {
    dispatcher_state.scheduling_requested = false;
    const pending_assignments =
      await materializePendingAssignments(shared_context);
    const active_flow_instances = new Set(
      Array.from(dispatcher_state.active_assignments.values()).map(
        (assignment) => assignment.flow_instance_id,
      ),
    );
    const assignable_flow_instances = pending_assignments.filter(
      (assignment) => !active_flow_instances.has(assignment.flow_instance_id),
    );
    const ready_workers = Array.from(dispatcher_state.workers.entries()).filter(
      ([, worker_state]) => worker_state.state === 'ready',
    );

    for (
      let index = 0;
      index < ready_workers.length && index < assignable_flow_instances.length;
      index += 1
    ) {
      const [worker_id, worker_state] = ready_workers[index];
      const assignment = assignable_flow_instances[index];

      worker_state.state = 'busy';
      dispatcher_state.active_assignments.set(assignment.assignment_id, {
        flow_instance_id: assignment.flow_instance_id,
        worker_id,
      });
      shared_context.log_to_operator(
        `[worker ${shared_context.worker_id} dispatcher] dispatching ${assignment.flow_instance_id} (${assignment.assignment_id}) to ${worker_id}`,
      );
      await shared_context.emit_event({
        assignment_id: assignment.assignment_id,
        flow_instance_id: assignment.flow_instance_id,
        kind: 'assignment_dispatched',
        worker_id,
      });

      if (worker_state.kind === 'dispatcher') {
        void executeDispatcherAssignment(
          assignment,
          dispatcher_state,
          shared_context,
        );

        continue;
      }

      worker_state.protocol_connection?.send(assignment);
    }
  }
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function executeDispatcherAssignment(
  assignment,
  dispatcher_state,
  shared_context,
) {
  try {
    const run_result = await executeAssignedFlowInstance(
      assignment,
      shared_context,
    );

    if (run_result.outcome === 'failure') {
      await handleDispatcherFollowerMessage(
        {
          assignment_id: assignment.assignment_id,
          error: run_result.worker_error ?? 'Assignment failed.',
          type: 'assignment_failed',
          worker_id: shared_context.worker_id,
        },
        shared_context,
        dispatcher_state,
      );

      return;
    }

    await handleDispatcherFollowerMessage(
      {
        assignment_id: assignment.assignment_id,
        type: 'assignment_completed',
        worker_id: shared_context.worker_id,
      },
      shared_context,
      dispatcher_state,
    );
  } catch (error) {
    await handleDispatcherFollowerMessage(
      {
        assignment_id: assignment.assignment_id,
        error: readErrorMessage(error),
        type: 'assignment_failed',
        worker_id: shared_context.worker_id,
      },
      shared_context,
      dispatcher_state,
    );
  }
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: ReturnType<typeof resolveGraphApi>,
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
    const runtime_record = /** @type {Record<string, unknown>} */ (
      JSON.parse(await readFile(assignment.resume_runtime_record_path, 'utf8'))
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
      worker_client: /** @type {any} */ (execution_context.worker_client),
    });
  }

  if (
    typeof assignment.await_query !== 'string' ||
    assignment.binding_targets === undefined ||
    typeof assignment.contract_path !== 'string' ||
    !Array.isArray(assignment.decision_paths) ||
    typeof assignment.flow_id !== 'string' ||
    typeof assignment.flow_path !== 'string' ||
    !Array.isArray(assignment.ordered_steps) ||
    typeof assignment.task_id !== 'string' ||
    typeof assignment.task_path !== 'string' ||
    assignment.transition_conditions === undefined ||
    assignment.transition_target_bindings === undefined ||
    assignment.transition_targets === undefined ||
    assignment.worktree_policy === undefined
  ) {
    throw new Error(
      `Assignment ${assignment.assignment_id} is missing required execution fields.`,
    );
  }

  const project_graph_result =
    await execution_context.graph_api.load_project_graph(
      execution_context.repo_directory,
    );

  return runTaskAttempt(execution_context.repo_directory, {
    await_query: assignment.await_query,
    binding_targets: assignment.binding_targets,
    contract_path: assignment.contract_path,
    decision_paths: assignment.decision_paths,
    durable_graph: project_graph_result.graph,
    flow_id: assignment.flow_id,
    flow_path: assignment.flow_path,
    graph_api: {
      query_graph: execution_context.graph_api.query_graph,
    },
    now: execution_context.now,
    operator_io: execution_context.operator_io,
    ordered_steps: assignment.ordered_steps,
    relation_names: Object.keys(project_graph_result.config.relations ?? {}),
    runtime_label: DISPATCH_RUNTIME_LABEL,
    task_id: assignment.task_id,
    task_path: assignment.task_path,
    transition_conditions: assignment.transition_conditions,
    transition_target_bindings: assignment.transition_target_bindings,
    transition_targets: assignment.transition_targets,
    worker_client: /** @type {any} */ (execution_context.worker_client),
    worktree_policy: assignment.worktree_policy,
  });
}

/**
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<Array<Extract<LocalDispatchMessage, { type: 'assignment' }>>>}
 */
async function materializePendingAssignments(shared_context) {
  const pending_assignments = new Map();
  const unresolved_runtime_records = await listUnresolvedRuntimeRecords(
    shared_context.repo_directory,
  );

  for (const unresolved_runtime_record of unresolved_runtime_records) {
    const assignment = createResumeAssignment(unresolved_runtime_record);

    if (assignment !== null) {
      pending_assignments.set(assignment.flow_instance_id, assignment);
    }
  }

  const project_graph_result =
    await shared_context.graph_api.load_project_graph(
      shared_context.repo_directory,
    );
  const contract_nodes = queryDispatchContracts(
    project_graph_result,
    shared_context.graph_api,
  );

  for (const contract_node of contract_nodes) {
    const flow_node = resolveSingleRelatedNode(
      contract_node,
      'root_flow',
      project_graph_result.graph,
    );
    const contract_path = readRequiredNodePath(
      contract_node,
      'dispatch contract',
    );
    const flow_path = readRequiredNodePath(flow_node, 'dispatch flow');
    const dispatch_flow = await loadDispatchFlow(
      shared_context.repo_directory,
      flow_path,
    );
    const trigger_candidates = queryCandidateTasks(
      contract_node,
      dispatch_flow.trigger.query_text,
      project_graph_result,
      shared_context.graph_api,
    );

    for (const trigger_node of trigger_candidates) {
      const runnable_job = selectRunnableDispatchJob(
        dispatch_flow,
        project_graph_result,
        shared_context.graph_api,
        contract_node,
        trigger_node,
      );

      if (runnable_job === null) {
        continue;
      }

      const trigger_binding = {
        id: readRequiredNodeId(trigger_node, 'trigger document'),
        path: readRequiredNodePath(trigger_node, 'trigger document'),
        status: readRequiredNodeStatus(trigger_node, 'trigger document'),
      };
      const flow_instance_id = createFlowInstanceId(
        contract_path,
        flow_path,
        dispatch_flow.trigger.binding_name,
        trigger_binding.id,
      );

      if (pending_assignments.has(flow_instance_id)) {
        continue;
      }

      pending_assignments.set(flow_instance_id, {
        assignment_id: flow_instance_id,
        await_query: runnable_job.await_query,
        binding_targets: createDispatchBindingTargets(
          contract_node,
          dispatch_flow.trigger.binding_name,
          trigger_binding,
        ),
        contract_path,
        decision_paths: collectRelatedPaths(
          contract_node,
          'decided_by',
          project_graph_result.graph,
        ),
        flow_id: readRequiredNodeId(flow_node, 'dispatch flow'),
        flow_instance_id,
        flow_path,
        ordered_steps: runnable_job.ordered_steps,
        task_id: createFlowInstanceTaskId(flow_instance_id),
        task_path: trigger_binding.path,
        transition_conditions: runnable_job.transition_conditions,
        transition_target_bindings: runnable_job.transition_target_bindings,
        transition_targets: runnable_job.transition_targets,
        type: 'assignment',
        worktree_policy: runnable_job.worktree_policy,
      });
    }
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
 * @returns {Extract<LocalDispatchMessage, { type: 'assignment' }> | null}
 */
function createResumeAssignment(unresolved_runtime_record) {
  const approval = getRuntimeRecordApproval(unresolved_runtime_record.record);

  if (approval?.approved_at === null) {
    return null;
  }

  const binding_targets = getRuntimeRecordBindingTargets(
    unresolved_runtime_record.record,
  );
  const contract_path = getRuntimeRecordContractPath(
    unresolved_runtime_record.record,
  );
  const flow_path = getRuntimeRecordFlowPath(unresolved_runtime_record.record);

  if (
    binding_targets === null ||
    typeof contract_path !== 'string' ||
    typeof flow_path !== 'string'
  ) {
    return null;
  }

  const [binding_name, binding_target] =
    selectFlowInstanceBinding(binding_targets);
  const flow_instance_id = createFlowInstanceId(
    contract_path,
    flow_path,
    binding_name,
    binding_target.id,
  );

  return {
    assignment_id: flow_instance_id,
    flow_instance_id,
    resume_runtime_record_path: unresolved_runtime_record.runtime_record_path,
    type: 'assignment',
  };
}

/**
 * @param {{
 *   ordered_jobs: Array<
 *     | {
 *         await_query: string,
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'triggered-document',
 *         needs: string[],
 *         ordered_steps: Array<
 *           | { command_text: string, kind: 'run' }
 *           | { kind: 'uses', step_name: string }
 *         >,
 *         transition_conditions: { failure: string, success: string },
 *         transition_target_bindings: { failure: string, success: string },
 *         transition_targets: { failure: string, success: string },
 *         worktree_policy:
 *           | { mode: 'ephemeral' }
 *           | { mode: 'named', slot: string },
 *       }
 *     | {
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'document-transition',
 *         needs: string[],
 *         transition_target_binding: 'document',
 *         transition_target_state: string,
 *       }
 *   >,
 *   trigger: {
 *     binding_name: string,
 *     query_text: string,
 *     role: string,
 *   },
 * }} dispatch_flow
 * @param {ProjectGraphResult} project_graph_result
 * @param {DispatchGraphApi} graph_api
 * @param {GraphNode} contract_node
 * @param {GraphNode} trigger_node
 * @returns {Extract<
 *   Awaited<ReturnType<typeof loadDispatchFlow>>['ordered_jobs'][number],
 *   { kind: 'triggered-document' }
 * > | null}
 */
function selectRunnableDispatchJob(
  dispatch_flow,
  project_graph_result,
  graph_api,
  contract_node,
  trigger_node,
) {
  /** @type {Set<string>} */
  const exhausted_jobs = new Set();
  const relation_bindings = {
    document: readRequiredNodeId(contract_node, 'dispatch contract'),
    [dispatch_flow.trigger.binding_name]: readRequiredNodeId(
      trigger_node,
      'trigger document',
    ),
  };

  for (const supported_job of dispatch_flow.ordered_jobs) {
    if (
      !supported_job.needs.every((job_name) => exhausted_jobs.has(job_name))
    ) {
      continue;
    }

    if (
      supported_job.if_query !== null &&
      !evaluateGraphCondition(
        project_graph_result.graph,
        supported_job.if_query,
        project_graph_result,
        graph_api,
        relation_bindings,
      )
    ) {
      exhausted_jobs.add(supported_job.job_name);
      continue;
    }

    if (supported_job.kind === 'document-transition') {
      exhausted_jobs.add(supported_job.job_name);
      continue;
    }

    return supported_job;
  }

  return null;
}

/**
 * @param {ProjectGraphResult} project_graph_result
 * @param {DispatchGraphApi} graph_api
 * @returns {GraphNode[]}
 */
function queryDispatchContracts(project_graph_result, graph_api) {
  const query_result = graph_api.query_graph(
    project_graph_result.graph,
    `$class=contract and status in [${SUPPORTED_DISPATCH_CONTRACT_STATUSES.join(', ')}] and root_flow:*`,
    project_graph_result.config,
  );

  if (query_result.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(query_result.diagnostics));
  }

  return query_result.nodes;
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
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * } | undefined} dispatcher_state
 * @param {string} assignment_id
 * @param {string} worker_id
 * @returns {void}
 */
function markWorkerReady(dispatcher_state, assignment_id, worker_id) {
  if (dispatcher_state === undefined) {
    return;
  }

  dispatcher_state.active_assignments.delete(assignment_id);
  const worker_state = dispatcher_state.workers.get(worker_id);

  if (worker_state !== undefined) {
    worker_state.state = 'ready';
  }
}

/**
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {string} worker_id
 * @returns {number}
 */
function releaseWorkerAssignments(dispatcher_state, worker_id) {
  let released_assignment_count = 0;

  for (const [
    assignment_id,
    active_assignment,
  ] of dispatcher_state.active_assignments) {
    if (active_assignment.worker_id === worker_id) {
      dispatcher_state.active_assignments.delete(assignment_id);
      released_assignment_count += 1;
    }
  }

  return released_assignment_count;
}

/**
 * @param {unknown[]} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  const resolved_diagnostics = /** @type {Array<{
   *   file_path?: string,
   *   message: string,
   *   path?: string,
   * }>} */ (diagnostics);

  return resolved_diagnostics
    .map(
      /**
       * @param {{ file_path?: string, message: string, path?: string }} diagnostic
       * @returns {string}
       */
      (diagnostic) =>
        `${diagnostic.path ?? diagnostic.file_path ?? '<unknown>'}: ${diagnostic.message}`,
    )
    .join('\n');
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeId(node, label) {
  if (typeof node.$id !== 'string') {
    throw new Error(`Expected ${label} to expose a Patram id.`);
  }

  return node.$id;
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodePath(node, label) {
  if (typeof node.$path !== 'string') {
    throw new Error(`Expected ${label} to expose a path.`);
  }

  return node.$path;
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeStatus(node, label) {
  if (typeof node.status !== 'string') {
    throw new Error(`Expected ${label} to expose a status.`);
  }

  return node.status;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: ReturnType<typeof resolveGraphApi>,
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
 * @returns {{
 *   graph_api: ReturnType<typeof resolveGraphApi>,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory: string,
 *   worker_client?: Record<string, unknown>,
 * }}
 */
function readAssignmentExecutionContext(shared_context) {
  if (
    shared_context.graph_api === undefined ||
    shared_context.now === undefined ||
    typeof shared_context.repo_directory !== 'string'
  ) {
    throw new Error('Expected assignment execution context to be fully bound.');
  }

  return {
    graph_api: shared_context.graph_api,
    now: shared_context.now,
    operator_io: shared_context.operator_io,
    repo_directory: shared_context.repo_directory,
    worker_client: shared_context.worker_client,
  };
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {{
 *   cleanup: () => Promise<void>,
 *   signal?: AbortSignal,
 * }}
 */
function createWorkerSignalContext(signal) {
  if (signal) {
    return {
      async cleanup() {},
      signal,
    };
  }

  const abort_controller = new globalThis.AbortController();
  const abort_worker = () => {
    abort_controller.abort();
  };

  process.once('SIGINT', abort_worker);
  process.once('SIGTERM', abort_worker);

  return {
    async cleanup() {
      process.off('SIGINT', abort_worker);
      process.off('SIGTERM', abort_worker);
    },
    signal: abort_controller.signal,
  };
}

/**
 * @param {string} endpoint
 * @param {((event: Record<string, unknown>) => void | Promise<void>) | undefined} on_event
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @param {AbortSignal | undefined} signal
 * @param {string} worker_id
 * @param {ReturnType<typeof resolveGraphApi>} graph_api
 * @param {string} repo_directory
 * @param {WorkerClient | undefined} worker_client
 * @param {() => Date} now
 * @returns {SharedSessionContext}
 */
function createSharedSessionContext(
  endpoint,
  on_event,
  operator_io,
  signal,
  worker_id,
  graph_api,
  repo_directory,
  worker_client,
  now,
) {
  return {
    async emit_event(event) {
      if (typeof on_event === 'function') {
        await on_event({
          ...event,
          endpoint,
        });
      }
    },
    endpoint,
    graph_api,
    log_to_operator(line) {
      operator_io?.stdout.write(`${line}\n`);
    },
    now,
    operator_io,
    repo_directory,
    signal,
    worker_id,
    worker_client,
  };
}

/**
 * @returns {{
 *   resolve: () => void,
 *   stopped: Promise<void>,
 *   stopped_requested: boolean,
 * }}
 */
function createStopContext() {
  /** @type {(value?: void | PromiseLike<void>) => void} */
  let resolve = () => {};
  const stopped = new Promise((resolve_stop) => {
    resolve = resolve_stop;
  });

  return {
    resolve() {
      resolve();
    },
    stopped,
    stopped_requested: false,
  };
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {() => Promise<void>} stop
 * @returns {void}
 */
function registerAbort(signal, stop) {
  signal?.addEventListener(
    'abort',
    () => {
      void stop();
    },
    {
      once: true,
    },
  );
}

/**
 * @returns {string}
 */
function createWorkerId() {
  return `worker-${process.pid}-${Date.now().toString(36)}`;
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}

/**
 * @param {number} count
 * @returns {string}
 */
function pluralize(count) {
  if (count === 1) {
    return '';
  }

  return 's';
}
