/** @import { LocalDispatchMessage } from './protocol.js' */

export { parseProtocolMessage };

/** @type {Record<string, (message: Record<string, unknown>) => LocalDispatchMessage>} */
const MESSAGE_PARSERS = {
  assignment: parseAssignment,
  assignment_completed: parseAssignmentCompleted,
  assignment_failed: parseAssignmentFailed,
  assignment_pending_approval: parseAssignmentPendingApproval,
  dispatch_assignment: parseDispatchAssignment,
  dispatch_notified: parseDispatchNotified,
  notify_dispatch: parseNotifyDispatch,
  register_worker: parseRegisterWorker,
  status_report: parseStatusReport,
  status_request: parseStatusRequest,
  worker_registered: parseWorkerRegistered,
};

/**
 * @param {string} line
 * @returns {LocalDispatchMessage}
 */
function parseProtocolMessage(line) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(line));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected a local dispatch message object.');
  }

  const parsed_message = /** @type {Record<string, unknown>} */ (parsed_value);
  const message_type = parsed_message.type;
  const parser =
    typeof message_type === 'string'
      ? MESSAGE_PARSERS[message_type]
      : undefined;

  if (parser !== undefined) {
    return parser(parsed_message);
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
 * @returns {Extract<LocalDispatchMessage, { type: 'dispatch_assignment' }>}
 */
function parseDispatchAssignment(message) {
  if (
    message.type !== 'dispatch_assignment' ||
    typeof message.assignment_id !== 'string' ||
    typeof message.flow_instance_id !== 'string' ||
    typeof message.source !== 'string'
  ) {
    throw new Error(
      'Expected dispatch_assignment to include assignment_id, flow_instance_id, and source.',
    );
  }

  return /** @type {Extract<LocalDispatchMessage, { type: 'dispatch_assignment' }>} */ (
    message
  );
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{ type: 'status_request' }}
 */
function parseStatusRequest(message) {
  if (message.type !== 'status_request') {
    throw new Error('Expected status_request to include only type.');
  }

  return {
    type: 'status_request',
  };
}

/**
 * @param {Record<string, unknown>} message
 * @returns {{
 *   active_assignments: Array<{ flow_instance_id: string, worker_id: string }>,
 *   connected_worker_count: number,
 *   dispatcher_id: string,
 *   type: 'status_report',
 * }}
 */
function parseStatusReport(message) {
  if (
    typeof message.dispatcher_id !== 'string' ||
    typeof message.connected_worker_count !== 'number' ||
    !Array.isArray(message.active_assignments)
  ) {
    throw new Error(
      'Expected status_report to include dispatcher_id, connected_worker_count, and active_assignments.',
    );
  }

  return {
    active_assignments: message.active_assignments.map(
      /**
       * @param {unknown} active_assignment
       * @returns {{ flow_instance_id: string, worker_id: string }}
       */
      (active_assignment) => {
        if (
          active_assignment === null ||
          typeof active_assignment !== 'object' ||
          Array.isArray(active_assignment)
        ) {
          throw new Error(
            'Expected status_report active_assignments to include flow_instance_id and worker_id.',
          );
        }

        const active_assignment_record =
          /** @type {Record<string, unknown>} */ (active_assignment);

        if (
          typeof active_assignment_record.flow_instance_id !== 'string' ||
          typeof active_assignment_record.worker_id !== 'string'
        ) {
          throw new Error(
            'Expected status_report active_assignments to include flow_instance_id and worker_id.',
          );
        }

        return {
          flow_instance_id: active_assignment_record.flow_instance_id,
          worker_id: active_assignment_record.worker_id,
        };
      },
    ),
    connected_worker_count: message.connected_worker_count,
    dispatcher_id: message.dispatcher_id,
    type: 'status_report',
  };
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
 * @returns {{ flow_instance_id?: string, source: string, type: 'notify_dispatch' }}
 */
function parseNotifyDispatch(message) {
  if (
    typeof message.source !== 'string' ||
    ('flow_instance_id' in message &&
      message.flow_instance_id !== undefined &&
      typeof message.flow_instance_id !== 'string')
  ) {
    throw new Error('Expected notify_dispatch to include source.');
  }

  return {
    flow_instance_id:
      typeof message.flow_instance_id === 'string'
        ? message.flow_instance_id
        : undefined,
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
