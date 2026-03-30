/**
 * @import { Server, Socket } from 'node:net';
 */
/* eslint-disable max-lines, max-lines-per-function */
/**
 * Local IPC endpoint and newline-delimited protocol helpers for dispatch.
 *
 * Decided by: ../../../docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
 * Decided by: ../../../docs/decisions/runtime/flattened-dispatcher-socket-path.md
 * Implements: ../../../docs/contracts/runtime/local-dispatch-runtime.md
 * @patram
 */
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

import { parseProtocolMessage } from './protocol-message.js';

export {
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
};

const PRAVAHA_DIRECTORY = '.pravaha';
const DISPATCH_SOCKET_FILE = 'dispatcher.sock';
/**
 * @typedef {{
 *   assignment_id: string,
 *   binding_targets?: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   contract_path?: string,
 *   decision_paths?: string[],
 *   flow_instance_id: string,
 *   flow_path?: string,
 *   ordered_jobs?: Array<
 *     | { end_state: string, job_name: string, kind: 'end' }
 *     | {
 *         job_name: string,
 *         kind: 'action',
 *         limits: { max_visits: number } | null,
 *         next_branches: Array<{
 *           condition_text: string | null,
 *           target_job_name: string,
 *         }>,
 *         uses_value: string,
 *         with_value: unknown,
 *       }
 *   >,
 *   resume_runtime_record_path?: string,
 *   start_job_name?: string,
 *   task_id?: string,
 *   task_path?: string,
 *   type: 'assignment',
 *   workspace?: {
 *     id?: string,
 *     materialize: {
 *       kind: 'worktree',
 *       mode: 'ephemeral' | 'pooled',
 *       ref: string,
 *     },
 *     location?: {
 *       path: string,
 *     },
 *     source: {
 *       id?: string,
 *       ids?: string[],
 *       kind: 'repo',
 *     },
 *     type: 'git.workspace',
 *   },
 * }
 *   | ({
 *       assignment_id: string,
 *       binding_targets?: Record<
 *         string,
 *         { id: string, path: string, status: string } | undefined
 *       >,
 *       contract_path?: string,
 *       decision_paths?: string[],
 *       flow_instance_id: string,
 *       flow_path?: string,
 *       ordered_jobs?: Array<
 *         | { end_state: string, job_name: string, kind: 'end' }
 *         | {
 *             job_name: string,
 *             kind: 'action',
 *             limits: { max_visits: number } | null,
 *             next_branches: Array<{
 *               condition_text: string | null,
 *               target_job_name: string,
 *             }>,
 *             uses_value: string,
 *             with_value: unknown,
 *           }
 *       >,
 *       source: string,
 *       start_job_name?: string,
 *       task_id?: string,
 *       task_path?: string,
 *       type: 'dispatch_assignment',
 *       workspace?: {
 *         id?: string,
 *         materialize: {
 *           kind: 'worktree',
 *           mode: 'ephemeral' | 'pooled',
 *           ref: string,
 *         },
 *         location?: {
 *           path: string,
 *         },
 *         source: {
 *           id?: string,
 *           ids?: string[],
 *           kind: 'repo',
 *         },
 *         type: 'git.workspace',
 *       },
 *     })
 *   | { assignment_id: string, type: 'assignment_pending_approval', worker_id: string }
 *   | { assignment_id: string, type: 'assignment_completed', worker_id: string }
 *   | { assignment_id: string, error: string, type: 'assignment_failed', worker_id: string }
 *   | { dispatcher_id: string, type: 'dispatch_notified' }
 *   | { type: 'status_request' }
 *   | {
 *       active_assignments: Array<{
 *         flow_instance_id: string,
 *         worker_id: string,
 *       }>,
 *       connected_worker_count: number,
 *       dispatcher_id: string,
 *       type: 'status_report',
 *     }
 *   | {
 *       flow_instance_id?: string,
 *       source: string,
 *       type: 'notify_dispatch',
 *     }
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

  const directory = join(resolved_repo_directory, PRAVAHA_DIRECTORY);

  await mkdir(directory, { recursive: true });

  return {
    address: join(directory, DISPATCH_SOCKET_FILE),
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
  let messageHandler = null;
  /** @type {(value?: void | PromiseLike<void>) => void} */
  let resolveClosed = () => {};
  /** @type {Promise<void>} */
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  socket.setEncoding('utf8');
  attachSocketReader(socket, (message) => {
    if (typeof messageHandler === 'function') {
      Promise.resolve(messageHandler(message)).catch((error) => {
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
    resolveClosed();
  });
  socket.on('error', () => {
    resolveClosed();
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
      messageHandler = next_handler;

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
 *   stderr?: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @param {unknown} error
 * @returns {void}
 */
function reportOperatorError(operator_io, error) {
  if (!operator_io || operator_io.stderr === undefined) {
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
  let buffered_data = '';

  socket.on('data', (chunk) => {
    buffered_data += String(chunk);
    const lines = buffered_data.split('\n');
    buffered_data = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }

      on_message(parseProtocolMessage(line));
    }
  });
  socket.on('end', () => {
    if (buffered_data.trim() === '') {
      return;
    }

    on_message(parseProtocolMessage(buffered_data));
    buffered_data = '';
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
 * @param {unknown} error
 * @returns {boolean}
 */
function isUnavailableConnectionError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ENOENT', 'ECONNREFUSED'].includes(error.code)
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
