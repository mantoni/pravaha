/** @import { OptionalGraphApi } from '../../shared/types/patram-types.ts' */
import process from 'node:process';

import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import {
  createCurrentDate,
  createSharedSessionContext,
  createStopContext,
  createWorkerId,
  registerAbort,
} from './context.js';
import { resolveDispatchEndpoint } from './protocol.js';
import { acquireWorkerRoleSession } from './worker-role-session.js';

export { startWorkerSession };

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
 * @returns {Promise<WorkerSession>}
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

  if (active_session === null) {
    throw new Error('Expected the worker to acquire a runtime role.');
  }

  /** @type {WorkerSession} */
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
  /** @type {{ active_session: WorkerSession | null }} */
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
 * @param {Awaited<ReturnType<typeof resolveDispatchEndpoint>>} endpoint
 * @param {ReturnType<typeof createSharedSessionContext>} shared_context
 * @param {{ active_session: WorkerSession | null }} session_state
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

    if (stop_context.stopped_requested) {
      if (next_session !== null) {
        await next_session.stop();
      }

      stop_context.resolve();

      return;
    }

    session_state.active_session = next_session;

    if (next_session === null) {
      break;
    }

    worker_session.dispatcher_id = next_session.dispatcher_id;
    worker_session.role = next_session.role;
  }

  stop_context.resolve();
}

/**
 * @param {{ active_session: WorkerSession | null }} session_state
 * @param {StopContext} stop_context
 * @returns {Promise<void>}
 */
async function stopManagedWorkerSession(session_state, stop_context) {
  if (stop_context.stopped_requested) {
    return stop_context.stopped;
  }

  stop_context.stopped_requested = true;

  if (session_state.active_session === null) {
    stop_context.resolve();

    return stop_context.stopped;
  }

  await session_state.active_session.stop();

  return stop_context.stopped;
}
