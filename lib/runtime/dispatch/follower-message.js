/** @import { LocalDispatchMessage } from './protocol.js' */
/** @import { DispatcherState, SharedSessionContext } from './dispatcher.js' */

export { handleDispatcherFollowerMessage };

/**
 * @param {LocalDispatchMessage} message
 * @param {SharedSessionContext} shared_context
 * @param {DispatcherState | undefined} [dispatcher_state]
 * @param {((
 *   dispatcher_state: DispatcherState | undefined,
 *   shared_context: SharedSessionContext,
 * ) => void) | undefined} [request_dispatcher_scheduling]
 * @returns {Promise<void>}
 */
async function handleDispatcherFollowerMessage(
  message,
  shared_context,
  dispatcher_state,
  request_dispatcher_scheduling,
) {
  if (message.type === 'assignment_pending_approval') {
    shared_context.log_to_operator(
      `[worker ${shared_context.worker_id} dispatcher] assignment waiting for approval ${message.assignment_id} on ${message.worker_id}`,
    );
    await shared_context.emit_event({
      assignment_id: message.assignment_id,
      kind: 'assignment_pending_approval',
      worker_id: message.worker_id,
    });
    markWorkerReady(dispatcher_state, message.assignment_id, message.worker_id);
    request_dispatcher_scheduling?.(dispatcher_state, shared_context);

    return;
  }

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
    request_dispatcher_scheduling?.(dispatcher_state, shared_context);

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
    request_dispatcher_scheduling?.(dispatcher_state, shared_context);

    return;
  }

  throw new Error(`Unexpected dispatcher message ${message.type}.`);
}

/**
 * @param {DispatcherState | undefined} dispatcher_state
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
