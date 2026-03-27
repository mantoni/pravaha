/* eslint-disable max-lines */
/**
 * Local worker-pool runtime with dispatcher election over machine-local IPC.
 *
 * Decided by: ../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Implements: ../docs/contracts/runtime/local-dispatch-runtime.md
 * @patram
 */
import { createServer } from 'node:net';
import process from 'node:process';

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
 * @typedef {{ assignment_id: string, flow_instance_id: string, type: 'assignment' }
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
 * @param {string} repo_directory
 * @param {{
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   signal?: AbortSignal,
 *   worker_id?: string,
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
    operator_io: options.operator_io,
    signal: signal_context.signal,
    worker_id: options.worker_id,
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
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   on_event?: (event: Record<string, unknown>) => void | Promise<void>,
 *   platform?: NodeJS.Platform,
 *   signal?: AbortSignal,
 *   worker_id?: string,
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
  const stop_context = createStopContext();

  dispatcher_server.on('connection', (socket) => {
    const protocol_connection = createProtocolConnection(socket);

    void handleDispatcherConnection(
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
  registerAbort(shared_context.signal, () =>
    stopDispatcherSession(
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
    handleFollowerMessage(message, shared_context),
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
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatcherConnection(
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
      `[worker ${shared_context.worker_id} dispatcher] listening on ${shared_context.endpoint}`,
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
 * @param {import('node:net').Server} dispatcher_server
 * @param {{
 *   address: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }} endpoint
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {ReturnType<typeof createStopContext>} stop_context
 * @returns {Promise<void>}
 */
async function stopDispatcherSession(
  dispatcher_server,
  endpoint,
  follower_connections,
  stop_context,
) {
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;

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
 * @param {import('node:net').Server} dispatcher_server
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
 * @param {{ source: string, type: 'notify_dispatch' }} notification_message
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatchNotification(
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
}

/**
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {string} follower_id
 * @param {ProtocolConnection} protocol_connection
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function registerFollower(
  follower_connections,
  follower_id,
  protocol_connection,
  shared_context,
) {
  follower_connections.set(follower_id, protocol_connection);
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
    handleDispatcherFollowerMessage(message, shared_context),
  );
  await protocol_connection.wait_until_closed();
  follower_connections.delete(follower_id);
}

/**
 * @param {LocalDispatchMessage} message
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleFollowerMessage(message, shared_context) {
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
}

/**
 * @param {LocalDispatchMessage} message
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatcherFollowerMessage(message, shared_context) {
  if (message.type === 'assignment_completed') {
    await shared_context.emit_event({
      assignment_id: message.assignment_id,
      kind: 'assignment_completed',
      worker_id: message.worker_id,
    });

    return;
  }

  if (message.type === 'assignment_failed') {
    await shared_context.emit_event({
      assignment_id: message.assignment_id,
      error: message.error,
      kind: 'assignment_failed',
      worker_id: message.worker_id,
    });

    return;
  }

  throw new Error(`Unexpected dispatcher message ${message.type}.`);
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
 * @returns {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   log_to_operator: (line: string) => void,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   signal?: AbortSignal,
 *   worker_id: string,
 * }}
 */
function createSharedSessionContext(
  endpoint,
  on_event,
  operator_io,
  signal,
  worker_id,
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
    log_to_operator(line) {
      operator_io?.stdout.write(`${line}\n`);
    },
    operator_io,
    signal,
    worker_id,
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
