/** @import { SharedSessionContext } from './dispatcher.js' */

export { announceWorkerStart };

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
