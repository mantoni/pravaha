/**
 * @import { Server } from 'node:net';
 * @import { DispatcherState, SharedSessionContext } from './dispatcher.js';
 */
import { createServer } from 'node:net';
import {
  createStopContext,
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
  openProtocolConnection,
  removeStaleUnixSocket,
  reportOperatorError,
  waitForMessage,
} from './protocol.js';
import { announceWorkerStart } from './worker-start-event.js';
import { tryListen } from './listen.js';
export { acquireWorkerRoleSession };

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
 * }} WorkerRoleSession
 */
/**
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
 * @param {StopContext} stop_context
 * @returns {Promise<WorkerRoleSession | null>}
 */
async function acquireWorkerRoleSession(
  endpoint,
  shared_context,
  stop_context,
) {
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
      if (stop_context.stopped_requested) {
        return null;
      }

      if (isTransientFollowerRegistrationError(error)) {
        await waitForRetryInterval();

        continue;
      }

      throw error;
    }
  }

  return null;
}

/**
 * @param {DispatchEndpoint} endpoint
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<WorkerRoleSession | null>}
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
 * @returns {Promise<WorkerRoleSession>}
 */
async function startFollowerSession(endpoint, shared_context) {
  const protocol_connection = await openProtocolConnection(endpoint.address);

  if (protocol_connection === null) {
    throw new Error(
      'Expected a live dispatcher to accept follower registration.',
    );
  }

  const stop_context = createStopContext();
  void protocol_connection.wait_until_closed().then(() => {
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
 * @param {DispatcherState} dispatcher_state
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
