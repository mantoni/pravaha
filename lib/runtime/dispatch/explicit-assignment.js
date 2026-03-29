/** @import { OptionalGraphApi } from '../../shared/types/patram-types.ts' */
import { createWorkerSignalContext } from './context.js';
import { openProtocolConnection, waitForMessage } from './protocol.js';
import { startWorkerSession } from './worker-session.js';

export { dispatchAssignmentAndWait };

/**
 * @typedef {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<import('./protocol.js').LocalDispatchMessage>,
 *   send: (message: import('./protocol.js').LocalDispatchMessage) => void,
 *   setMessageHandler: (
 *     message_handler: (
 *       message: import('./protocol.js').LocalDispatchMessage,
 *     ) => void | Promise<void>,
 *   ) => void,
 *   wait_until_closed: () => Promise<void>,
 * }} ProtocolConnection
 */

/**
 * @param {string} repo_directory
 * @param {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   signal?: AbortSignal,
 *   source?: string,
 *   worker_id?: string,
 *   worker_client?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_id: string,
 * }>}
 */
async function dispatchAssignmentAndWait(
  repo_directory,
  assignment,
  options = {},
) {
  const signal_context = createWorkerSignalContext(options.signal);
  const worker_session = await startWorkerSession(repo_directory, {
    graph_api: options.graph_api,
    now: options.now,
    operator_io: options.operator_io,
    signal: signal_context.signal,
    worker_id: options.worker_id,
    worker_client: options.worker_client,
  });
  const protocol_connection = await openDispatcherConnection(
    worker_session,
    signal_context,
  );

  try {
    protocol_connection.send({
      ...assignment,
      source: options.source ?? 'dispatch-session',
      type: 'dispatch_assignment',
    });

    const response_message = await waitForMessage(
      protocol_connection,
      'Expected the dispatcher to report the explicit assignment outcome.',
    );

    if (
      response_message.type !== 'assignment_completed' &&
      response_message.type !== 'assignment_failed'
    ) {
      throw new Error(
        `Expected assignment_completed or assignment_failed, received ${response_message.type}.`,
      );
    }

    return createExplicitAssignmentResult(worker_session, response_message);
  } finally {
    await cleanupExplicitAssignmentSession(
      protocol_connection,
      signal_context,
      worker_session,
    );
  }
}

/**
 * @param {{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   stop: () => Promise<void>,
 * }} worker_session
 * @param {{
 *   cleanup: () => Promise<void>,
 *   signal?: AbortSignal,
 * }} signal_context
 * @returns {Promise<ProtocolConnection>}
 */
async function openDispatcherConnection(worker_session, signal_context) {
  const protocol_connection = await openProtocolConnection(
    worker_session.endpoint,
  );

  if (protocol_connection !== null) {
    return protocol_connection;
  }

  await worker_session.stop();
  await signal_context.cleanup();

  throw new Error(
    'Expected a live dispatcher to accept explicit assignment execution.',
  );
}

/**
 * @param {{
 *   dispatcher_id: string,
 *   endpoint: string,
 * }} worker_session
 * @param {Extract<
 *   import('./protocol.js').LocalDispatchMessage,
 *   | { type: 'assignment_completed' }
 *   | { type: 'assignment_failed' }
 * >} response_message
 * @returns {{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   outcome: 'failure' | 'success',
 *   worker_error: string | null,
 *   worker_id: string,
 * }}
 */
function createExplicitAssignmentResult(worker_session, response_message) {
  if (response_message.type === 'assignment_completed') {
    return {
      dispatcher_id: worker_session.dispatcher_id,
      endpoint: worker_session.endpoint,
      outcome: 'success',
      worker_error: null,
      worker_id: response_message.worker_id,
    };
  }

  return {
    dispatcher_id: worker_session.dispatcher_id,
    endpoint: worker_session.endpoint,
    outcome: 'failure',
    worker_error: response_message.error,
    worker_id: response_message.worker_id,
  };
}

/**
 * @param {ProtocolConnection} protocol_connection
 * @param {{
 *   cleanup: () => Promise<void>,
 *   signal?: AbortSignal,
 * }} signal_context
 * @param {{
 *   stop: () => Promise<void>,
 *   wait_until_stopped: () => Promise<void>,
 * }} worker_session
 * @returns {Promise<void>}
 */
async function cleanupExplicitAssignmentSession(
  protocol_connection,
  signal_context,
  worker_session,
) {
  protocol_connection.close();
  protocol_connection.destroy();
  await protocol_connection.wait_until_closed();
  await worker_session.stop();
  await worker_session.wait_until_stopped();
  await signal_context.cleanup();
}
