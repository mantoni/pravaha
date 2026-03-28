/**
 * @import { Server, Socket } from 'node:net';
 */
/* eslint-disable max-lines, max-lines-per-function */
/**
 * Local IPC endpoint and newline-delimited protocol helpers for dispatch.
 *
 * Decided by: ../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Implements: ../docs/contracts/runtime/local-dispatch-runtime.md
 * @patram
 */
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

export {
  canConnectToDispatcher,
  closeServer,
  createProtocolConnection,
  isAddressInUseError,
  isInitialProbeDisconnect,
  openProtocolConnection,
  parseProtocolMessage,
  removeStaleUnixSocket,
  reportOperatorError,
  resolveDispatchEndpoint,
  waitForMessage,
};

const DISPATCH_DIRECTORY = '.pravaha/dispatch';
/**
 * @typedef {{ assignment_id: string, flow_instance_id: string, type: 'assignment' }
 *   | { assignment_id: string, type: 'assignment_pending_approval', worker_id: string }
 *   | { assignment_id: string, type: 'assignment_completed', worker_id: string }
 *   | { assignment_id: string, error: string, type: 'assignment_failed', worker_id: string }
 *   | { dispatcher_id: string, type: 'dispatch_notified' }
 *   | { source: string, type: 'notify_dispatch' }
 *   | { type: 'register_worker', worker_id: string }
 *   | { dispatcher_id: string, type: 'worker_registered' }
 * } LocalDispatchMessage
 */

/**
 * @param {string} repo_directory
 * @param {NodeJS.Platform} platform
 * @returns {Promise<{
 *   address: string,
 *   directory?: string,
 *   kind: 'named-pipe' | 'unix-socket',
 * }>}
 */
async function resolveDispatchEndpoint(repo_directory, platform) {
  const resolved_repo_directory = resolve(repo_directory);

  if (platform === 'win32') {
    return {
      address: createWindowsPipeAddress(resolved_repo_directory),
      kind: 'named-pipe',
    };
  }

  const directory = join(resolved_repo_directory, DISPATCH_DIRECTORY);

  await mkdir(directory, { recursive: true });

  return {
    address: join(directory, 'leader.sock'),
    directory,
    kind: 'unix-socket',
  };
}

/**
 * @param {string} endpoint_address
 * @returns {Promise<boolean>}
 */
async function canConnectToDispatcher(endpoint_address) {
  const protocol_connection = await openProtocolConnection(endpoint_address);

  if (protocol_connection === null) {
    return false;
  }

  protocol_connection.close();
  protocol_connection.destroy();
  await protocol_connection.wait_until_closed();

  return true;
}

/**
 * @param {string} endpoint_address
 * @returns {Promise<ReturnType<typeof createProtocolConnection> | null>}
 */
async function openProtocolConnection(endpoint_address) {
  return new Promise((resolve_connection, reject_connection) => {
    const socket = createConnection(endpoint_address);
    let settled = false;

    socket.once('connect', () => {
      settled = true;
      resolve_connection(createProtocolConnection(socket));
    });
    socket.once('error', (error) => {
      if (settled) {
        return;
      }

      if (isUnavailableConnectionError(error)) {
        settled = true;
        resolve_connection(null);

        return;
      }

      settled = true;
      reject_connection(error);
    });
  });
}

/**
 * @param {Server} server
 * @returns {Promise<void>}
 */
async function closeServer(server) {
  if (!server.listening) {
    return;
  }

  await new Promise((resolve_close, reject_close) => {
    server.close((error) => {
      if (error) {
        reject_close(error);

        return;
      }

      resolve_close(undefined);
    });
  });
}

/**
 * @param {string} socket_path
 * @returns {Promise<void>}
 */
async function removeStaleUnixSocket(socket_path) {
  await rm(socket_path, { force: true });
}

/**
 * @param {ReturnType<typeof createProtocolConnection>} protocol_connection
 * @param {string} failure_message
 * @returns {Promise<LocalDispatchMessage>}
 */
async function waitForMessage(protocol_connection, failure_message) {
  try {
    return await protocol_connection.nextMessage();
  } catch (error) {
    throw new Error(failure_message, { cause: error });
  }
}

/**
 * @param {Socket} socket
 * @returns {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<LocalDispatchMessage>,
 *   send: (message: LocalDispatchMessage) => void,
 *   setMessageHandler: (
 *     message_handler: (message: LocalDispatchMessage) => void | Promise<void>,
 *   ) => void,
 *   wait_until_closed: () => Promise<void>,
 * }}
 */
function createProtocolConnection(socket) {
  /** @type {Array<LocalDispatchMessage>} */
  const message_queue = [];
  /** @type {Array<{ reject: (reason?: unknown) => void, resolve: (value: LocalDispatchMessage) => void }>} */
  const pending_reads = [];
  /** @type {((message: LocalDispatchMessage) => void | Promise<void>) | null} */
  let message_handler = null;
  /** @type {(value?: void | PromiseLike<void>) => void} */
  let resolve_closed = () => {};
  const closed = new Promise((resolve) => {
    resolve_closed = resolve;
  });

  socket.setEncoding('utf8');
  attachSocketReader(socket, (message) => {
    if (typeof message_handler === 'function') {
      Promise.resolve(message_handler(message)).catch((error) => {
        socket.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      });

      return;
    }

    const pending_read = pending_reads.shift();

    if (pending_read) {
      pending_read.resolve(message);

      return;
    }

    message_queue.push(message);
  });
  socket.on('close', () => {
    rejectPendingReads(pending_reads);
    resolve_closed();
  });
  socket.on('error', () => {
    resolve_closed();
  });

  return {
    close() {
      socket.end();
    },
    destroy(error) {
      if (error instanceof Error) {
        socket.destroy(error);

        return;
      }

      socket.destroy();
    },
    async nextMessage() {
      const queued_message = message_queue.shift();

      if (queued_message) {
        return queued_message;
      }

      return new Promise((resolve_message, reject_message) => {
        pending_reads.push({
          reject: reject_message,
          resolve: resolve_message,
        });
      });
    },
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    setMessageHandler(next_handler) {
      message_handler = next_handler;

      while (message_queue.length > 0) {
        const queued_message = message_queue.shift();

        if (queued_message) {
          Promise.resolve(next_handler(queued_message)).catch((error) => {
            socket.destroy(
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        }
      }
    },
    wait_until_closed() {
      return closed;
    },
  };
}

/**
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @param {unknown} error
 * @returns {void}
 */
function reportOperatorError(operator_io, error) {
  if (!operator_io) {
    return;
  }

  operator_io.stderr.write(`${readErrorMessage(error)}\n`);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAddressInUseError(error) {
  return (
    error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isInitialProbeDisconnect(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.message !==
    'Expected the client to send an initial local dispatch message.'
  ) {
    return false;
  }

  return (
    error.cause instanceof Error &&
    error.cause.message ===
      'The local dispatch connection closed before a message arrived.'
  );
}

/**
 * @param {string} pipe_seed
 * @returns {string}
 */
function createWindowsPipeAddress(pipe_seed) {
  const pipe_hash = createHash('sha256').update(pipe_seed).digest('hex');

  return `\\\\.\\pipe\\pravaha-${pipe_hash.slice(0, 16)}-dispatch`;
}

/**
 * @param {Socket} socket
 * @param {(message: LocalDispatchMessage) => void} on_message
 * @returns {void}
 */
function attachSocketReader(socket, on_message) {
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk;

    for (;;) {
      const newline_index = buffer.indexOf('\n');

      if (newline_index === -1) {
        return;
      }

      const line = buffer.slice(0, newline_index).trim();

      buffer = buffer.slice(newline_index + 1);

      if (line !== '') {
        on_message(parseProtocolMessage(line));
      }
    }
  });
}

/**
 * @param {Array<{ reject: (reason?: unknown) => void, resolve: (value: LocalDispatchMessage) => void }>} pending_reads
 * @returns {void}
 */
function rejectPendingReads(pending_reads) {
  for (const pending_read of pending_reads.splice(0)) {
    pending_read.reject(
      new Error(
        'The local dispatch connection closed before a message arrived.',
      ),
    );
  }
}

/**
 * @param {string} line
 * @returns {LocalDispatchMessage}
 */
function parseProtocolMessage(line) {
  const message = /** @type {Record<string, unknown>} */ (JSON.parse(line));
  const assignment_message = parseAssignment(message);

  if (assignment_message !== null) {
    return assignment_message;
  }

  const parsed_message =
    parseRegisterWorker(message) ??
    parseWorkerRegistered(message) ??
    parseNotifyDispatch(message) ??
    parseDispatchNotified(message) ??
    parseAssignmentPendingApproval(message) ??
    parseAssignmentCompleted(message) ??
    parseAssignmentFailed(message);

  if (parsed_message) {
    return parsed_message;
  }

  throw new Error(`Unsupported local dispatch message: ${line}`);
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, flow_instance_id: string, type: 'assignment' } | null}
 */
function parseAssignment(message) {
  if (
    message.type === 'assignment' &&
    typeof message.assignment_id === 'string' &&
    typeof message.flow_instance_id === 'string'
  ) {
    return /** @type {{ assignment_id: string, flow_instance_id: string, type: 'assignment' }} */ (
      message
    );
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ type: 'register_worker', worker_id: string } | null}
 */
function parseRegisterWorker(message) {
  if (
    message.type === 'register_worker' &&
    typeof message.worker_id === 'string'
  ) {
    return {
      type: 'register_worker',
      worker_id: message.worker_id,
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ dispatcher_id: string, type: 'worker_registered' } | null}
 */
function parseWorkerRegistered(message) {
  if (
    message.type === 'worker_registered' &&
    typeof message.dispatcher_id === 'string'
  ) {
    return {
      dispatcher_id: message.dispatcher_id,
      type: 'worker_registered',
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ source: string, type: 'notify_dispatch' } | null}
 */
function parseNotifyDispatch(message) {
  if (
    message.type === 'notify_dispatch' &&
    typeof message.source === 'string'
  ) {
    return {
      source: message.source,
      type: 'notify_dispatch',
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ dispatcher_id: string, type: 'dispatch_notified' } | null}
 */
function parseDispatchNotified(message) {
  if (
    message.type === 'dispatch_notified' &&
    typeof message.dispatcher_id === 'string'
  ) {
    return {
      dispatcher_id: message.dispatcher_id,
      type: 'dispatch_notified',
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, type: 'assignment_pending_approval', worker_id: string } | null}
 */
function parseAssignmentPendingApproval(message) {
  if (
    message.type === 'assignment_pending_approval' &&
    typeof message.assignment_id === 'string' &&
    typeof message.worker_id === 'string'
  ) {
    return {
      assignment_id: message.assignment_id,
      type: 'assignment_pending_approval',
      worker_id: message.worker_id,
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, type: 'assignment_completed', worker_id: string } | null}
 */
function parseAssignmentCompleted(message) {
  if (
    message.type === 'assignment_completed' &&
    typeof message.assignment_id === 'string' &&
    typeof message.worker_id === 'string'
  ) {
    return {
      assignment_id: message.assignment_id,
      type: 'assignment_completed',
      worker_id: message.worker_id,
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, error: string, type: 'assignment_failed', worker_id: string } | null}
 */
function parseAssignmentFailed(message) {
  if (
    message.type === 'assignment_failed' &&
    typeof message.assignment_id === 'string' &&
    typeof message.error === 'string' &&
    typeof message.worker_id === 'string'
  ) {
    return {
      assignment_id: message.assignment_id,
      error: message.error,
      type: 'assignment_failed',
      worker_id: message.worker_id,
    };
  }

  return null;
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isUnavailableConnectionError(error) {
  return (
    error instanceof Error &&
    ('code' in error
      ? error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
      : false)
  );
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
