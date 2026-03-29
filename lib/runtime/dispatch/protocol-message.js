/** @import { LocalDispatchMessage } from './protocol.js' */

export { parseProtocolMessage };

/** @type {Record<string, (message: Record<string, unknown>) => LocalDispatchMessage>} */
const MESSAGE_PARSERS = {
  assignment: parseAssignment,
  assignment_completed: parseAssignmentCompleted,
  assignment_failed: parseAssignmentFailed,
  assignment_pending_approval: parseAssignmentPendingApproval,
  dispatch_notified: parseDispatchNotified,
  notify_dispatch: parseNotifyDispatch,
  register_worker: parseRegisterWorker,
  worker_registered: parseWorkerRegistered,
};

/**
 * @param {string} line
 * @returns {LocalDispatchMessage}
 */
function parseProtocolMessage(line) {
  const parsed_value = JSON.parse(line);

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected a local dispatch message object.');
  }

  const message_type = parsed_value.type;
  const parser =
    typeof message_type === 'string'
      ? MESSAGE_PARSERS[message_type]
      : undefined;

  if (parser !== undefined) {
    return parser(parsed_value);
  }

  throw new Error(
    `Unsupported local dispatch message type "${String(message_type)}".`,
  );
}

/**
 * @param {Record<string, unknown>} message
 * @returns {Extract<LocalDispatchMessage, { type: 'assignment' }>}
 */
function parseAssignment(message) {
  if (
    message.type !== 'assignment' ||
    typeof message.assignment_id !== 'string' ||
    typeof message.flow_instance_id !== 'string'
  ) {
    throw new Error(
      'Expected assignment to include assignment_id and flow_instance_id.',
    );
  }

  return /** @type {Extract<LocalDispatchMessage, { type: 'assignment' }>} */ (
    message
  );
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ type: 'register_worker', worker_id: string }}
 */
function parseRegisterWorker(message) {
  if (typeof message.worker_id !== 'string') {
    throw new Error('Expected register_worker to include worker_id.');
  }

  return {
    type: 'register_worker',
    worker_id: message.worker_id,
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ dispatcher_id: string, type: 'worker_registered' }}
 */
function parseWorkerRegistered(message) {
  if (typeof message.dispatcher_id !== 'string') {
    throw new Error('Expected worker_registered to include dispatcher_id.');
  }

  return {
    dispatcher_id: message.dispatcher_id,
    type: 'worker_registered',
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ source: string, type: 'notify_dispatch' }}
 */
function parseNotifyDispatch(message) {
  if (typeof message.source !== 'string') {
    throw new Error('Expected notify_dispatch to include source.');
  }

  return {
    source: message.source,
    type: 'notify_dispatch',
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ dispatcher_id: string, type: 'dispatch_notified' }}
 */
function parseDispatchNotified(message) {
  if (typeof message.dispatcher_id !== 'string') {
    throw new Error('Expected dispatch_notified to include dispatcher_id.');
  }

  return {
    dispatcher_id: message.dispatcher_id,
    type: 'dispatch_notified',
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, type: 'assignment_pending_approval', worker_id: string }}
 */
function parseAssignmentPendingApproval(message) {
  if (
    typeof message.assignment_id !== 'string' ||
    typeof message.worker_id !== 'string'
  ) {
    throw new Error(
      'Expected assignment_pending_approval to include assignment_id and worker_id.',
    );
  }

  return {
    assignment_id: message.assignment_id,
    type: 'assignment_pending_approval',
    worker_id: message.worker_id,
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, type: 'assignment_completed', worker_id: string }}
 */
function parseAssignmentCompleted(message) {
  if (
    typeof message.assignment_id !== 'string' ||
    typeof message.worker_id !== 'string'
  ) {
    throw new Error(
      'Expected assignment_completed to include assignment_id and worker_id.',
    );
  }

  return {
    assignment_id: message.assignment_id,
    type: 'assignment_completed',
    worker_id: message.worker_id,
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ assignment_id: string, error: string, type: 'assignment_failed', worker_id: string }}
 */
function parseAssignmentFailed(message) {
  if (
    typeof message.assignment_id !== 'string' ||
    typeof message.error !== 'string' ||
    typeof message.worker_id !== 'string'
  ) {
    throw new Error(
      'Expected assignment_failed to include assignment_id, error, and worker_id.',
    );
  }

  return {
    assignment_id: message.assignment_id,
    error: message.error,
    type: 'assignment_failed',
    worker_id: message.worker_id,
  };
}
