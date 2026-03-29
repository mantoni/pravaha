/** @import { OptionalGraphApi } from '../../shared/types/patram-types.ts' */
import process from 'node:process';

import { createWorkerSignalContext } from './context.js';
import {
  openProtocolConnection,
  resolveDispatchEndpoint,
  waitForMessage,
} from './protocol.js';
import { startWorkerSession } from './worker-session.js';

export { dispatch, worker };

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
 *   flow_instance_id?: string,
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
      flow_instance_id:
        typeof options.flow_instance_id === 'string'
          ? options.flow_instance_id
          : undefined,
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
