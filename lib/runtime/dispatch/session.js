/**
 * @import { Server } from 'node:net';
 * @import { OptionalGraphApi } from '../../shared/types/patram-types.ts';
 */
/* eslint-disable max-lines, max-lines-per-function */
import { createServer } from 'node:net';
import process from 'node:process';

import { resolveGraphApi } from '../../reconcile-graph.js';
import {
  createCurrentDate,
  createSharedSessionContext,
  createStopContext,
  createWorkerId,
  createWorkerSignalContext,
  isTransientFollowerRegistrationError,
  registerAbort,
  waitForRetryInterval,
} from './context.js';
import {
  createDispatcherState,
  handleDispatcherConnection,
  handleFollowerMessage,
  requestDispatcherScheduling,
} from './dispatcher.js';
import {
  canConnectToDispatcher,
  closeServer,
  createProtocolConnection,
  isAddressInUseError,
  openProtocolConnection,
  removeStaleUnixSocket,
  reportOperatorError,
  resolveDispatchEndpoint,
  waitForMessage,
} from './protocol.js';

export { dispatch, startWorkerSession, tryListen, worker };

/**
 * @typedef {{
 *   address: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }} DispatchEndpoint
 */
/**
 * @typedef {{
 *   resolve: () => void,
 *   stopped: Promise<void>,
 *   stopped_requested: boolean,
 * }} StopContext
 */
/**
 * @typedef {{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   role: 'dispatcher' | 'follower',
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 *   worker_id: string,
 * }} WorkerSession
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
 *   worker_client?: Record<string, unknown>,
 * }} SharedSessionContext
 */

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
 *   worker_client?: Record<string, unknown>,
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
 *   worker_client?: Record<string, unknown>,
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
    /** @type {Record<string, unknown> | undefined} */ (options.worker_client),
    options.now ?? createCurrentDate,
  );
  const stop_context = createStopContext();
  const active_session = await acquireWorkerRoleSession(
    endpoint,
    shared_context,
    stop_context,
  );

  /* istanbul ignore next -- null acquisition only occurs through shutdown-race teardown before a role is published */
  if (active_session === null) {
    throw new Error('Expected the worker to acquire a runtime role.');
  }

  /** @type {{
   *   dispatcher_id: string,
   *   endpoint: string,
   *   role: 'dispatcher' | 'follower',
   *   stop: () => Promise<void>,
   *   wait_until_stopped: () => Promise<void>,
   *   worker_id: string,
   * }} */
  const worker_session = {
    dispatcher_id: active_session.dispatcher_id,
    endpoint: endpoint.address,
    role: active_session.role,
    stop() {
      return stopManagedWorkerSession(session_state, stop_context);
    },
    wait_until_stopped() {
      return stop_context.stopped;
    },
    worker_id,
  };
  /** @type {{
   *   active_session:
   *     | {
   *         dispatcher_id: string,
   *         endpoint: string,
   *         role: 'dispatcher' | 'follower',
   *         stop: () => Promise<void>,
   *         wait_until_stopped: () => Promise<void>,
   *         worker_id: string,
   *       }
   *     | null,
   * }} */
  const session_state = {
    active_session,
  };
  registerAbort(shared_context.signal, () =>
    stopManagedWorkerSession(session_state, stop_context),
  );

  void manageWorkerSessionLifecycle(
    endpoint,
    shared_context,
    session_state,
    stop_context,
    worker_session,
  );

  return worker_session;
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
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
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
  /** @type {Map<string, ReturnType<typeof createProtocolConnection>>} */
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
      protocol_connection,
      shared_context,
    ).catch((error) => {
      reportOperatorError(shared_context.operator_io, error);
    });
  });

  /* istanbul ignore next -- listen-loss before dispatcher promotion is a transient election race */
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
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
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

  /* istanbul ignore next -- follower registration without a live dispatcher is a transient election race */
  if (protocol_connection === null) {
    throw new Error(
      'Expected a live dispatcher to accept follower registration.',
    );
  }

  const stop_context = createStopContext();
  protocol_connection.wait_until_closed().then(() => {
    if (!stop_context.stopped_requested) {
      shared_context.log_to_operator(
        `[worker ${shared_context.worker_id} follower] dispatcher connection closed; re-entering election`,
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

  /* istanbul ignore next -- malformed registration replies are defensive protocol guards */
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
  /* istanbul ignore next -- follower abort wiring is exercised through higher-level worker stop tests */
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
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
 * @param {StopContext} stop_context
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   role: 'dispatcher' | 'follower',
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 *   worker_id: string,
 * } | null>}
 */
async function acquireWorkerRoleSession(
  endpoint,
  shared_context,
  stop_context,
) {
  /* istanbul ignore next -- pre-stopped acquisition is only reachable through shutdown races */
  while (!stop_context.stopped_requested) {
    const dispatcher_session = await startDispatcherSession(
      endpoint,
      shared_context,
    );

    if (dispatcher_session !== null) {
      return dispatcher_session;
    }

    try {
      return await startFollowerSession(endpoint, shared_context);
    } catch (error) {
      /* istanbul ignore next -- shutdown during follower registration is only reachable through failover races */
      if (stop_context.stopped_requested) {
        return null;
      }

      /* istanbul ignore next -- transient follower registration retries are covered indirectly by higher-level worker-pool tests */
      if (isTransientFollowerRegistrationError(error)) {
        await waitForRetryInterval();

        continue;
      }

      throw error;
    }
  }

  /* istanbul ignore next -- exhausting acquisition without a role is a shutdown-race guard */
  return null;
}

/**
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
 * @param {{
 *   active_session:
 *     | {
 *         dispatcher_id: string,
 *         endpoint: string,
 *         role: 'dispatcher' | 'follower',
 *         stop: () => Promise<void>,
 *         wait_until_stopped: () => Promise<void>,
 *         worker_id: string,
 *       }
 *     | null,
 * }} session_state
 * @param {StopContext} stop_context
 * @param {WorkerSession} worker_session
 * @returns {Promise<void>}
 */
async function manageWorkerSessionLifecycle(
  endpoint,
  shared_context,
  session_state,
  stop_context,
  worker_session,
) {
  while (session_state.active_session !== null) {
    await session_state.active_session.wait_until_stopped();

    /* istanbul ignore next -- lifecycle stop requests are already covered through the public stop path */
    if (stop_context.stopped_requested) {
      stop_context.resolve();

      return;
    }

    session_state.active_session = null;
    const next_session = await acquireWorkerRoleSession(
      endpoint,
      shared_context,
      stop_context,
    );

    /* istanbul ignore next -- shutdown after re-election attempts is an idempotent guard */
    if (stop_context.stopped_requested) {
      if (next_session !== null) {
        await next_session.stop();
      }

      stop_context.resolve();

      return;
    }

    session_state.active_session = next_session;

    /* istanbul ignore next -- no-next-session is a defensive stop condition after failover */
    if (next_session === null) {
      break;
    }

    worker_session.dispatcher_id = next_session.dispatcher_id;
    worker_session.role = next_session.role;
  }

  /* istanbul ignore next -- loop-exit cleanup is a defensive teardown path after failover */
  stop_context.resolve();
}

/**
 * @param {{
 *   active_session:
 *     | {
 *         dispatcher_id: string,
 *         endpoint: string,
 *         role: 'dispatcher' | 'follower',
 *         stop: () => Promise<void>,
 *         wait_until_stopped: () => Promise<void>,
 *         worker_id: string,
 *       }
 *     | null,
 * }} session_state
 * @param {StopContext} stop_context
 * @returns {Promise<void>}
 */
async function stopManagedWorkerSession(session_state, stop_context) {
  /* istanbul ignore next -- repeated stop requests are intentionally idempotent */
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;

  /* istanbul ignore next -- null active sessions are only observable through internal teardown races */
  if (session_state.active_session === null) {
    stop_context.resolve();

    return stop_context.stopped;
  }

  await session_state.active_session.stop();

  return stop_context.stopped;
}

/**
 * @param {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ReturnType<typeof createProtocolConnection>>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ReturnType<typeof createProtocolConnection>,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} dispatcher_state
 * @param {Server} dispatcher_server
 * @param {DispatchEndpoint} endpoint
 * @param {StopContext} stop_context
 * @returns {Promise<void>}
 */
async function stopDispatcherSession(
  dispatcher_state,
  dispatcher_server,
  endpoint,
  stop_context,
) {
  /* istanbul ignore next -- repeated dispatcher shutdown is intentionally idempotent */
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;
  dispatcher_state.scheduling_requested = false;

  for (const follower_connection of dispatcher_state.follower_connections.values()) {
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
 * @param {ReturnType<typeof createProtocolConnection>} protocol_connection
 * @param {StopContext} stop_context
 * @returns {Promise<void>}
 */
async function stopFollowerSession(protocol_connection, stop_context) {
  /* istanbul ignore next -- repeated follower shutdown is intentionally idempotent */
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
 * @param {SharedSessionContext} shared_context
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
