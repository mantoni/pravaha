/** @import { GraphApi, ProjectGraphResult } from '../../patram-types.ts' */
/* eslint-disable max-lines */
import {
  executeAssignedFlowInstance,
  materializePendingAssignments,
} from './assignments.js';
import { pluralize, readErrorMessage } from './context.js';
import {
  isInitialProbeDisconnect,
  reportOperatorError,
  waitForMessage,
} from './protocol.js';

export {
  createDispatcherState,
  executeDispatcherAssignment,
  handleDispatchNotification,
  handleDispatcherConnection,
  handleDispatcherFollowerMessage,
  handleFollowerMessage,
  markWorkerReady,
  registerFollower,
  releaseWorkerAssignments,
  requestDispatcherScheduling,
  runDispatcherScheduling,
};

/**
 * @typedef {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<import('./protocol.js').LocalDispatchMessage>,
 *   send: (message: import('./protocol.js').LocalDispatchMessage) => void,
 *   setMessageHandler: (
 *     message_handler: (message: import('./protocol.js').LocalDispatchMessage) => void | Promise<void>,
 *   ) => void,
 *   wait_until_closed: () => Promise<void>,
 * }} ProtocolConnection
 */
/**
 * @typedef {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: {
 *     load_project_graph: (repo_directory: string) => Promise<ProjectGraphResult>,
 *     query_graph: GraphApi['query_graph'],
 *   },
 *   log_to_operator: (line: string) => void,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory?: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: Record<string, unknown>,
 * }} SharedSessionContext
 */
/**
 * @typedef {{
 *   active_assignments: Map<string, { flow_instance_id: string, worker_id: string }>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   scheduling_requested: boolean,
 *   scheduling_running: boolean,
 *   workers: Map<
 *     string,
 *     {
 *       kind: 'dispatcher' | 'follower',
 *       protocol_connection?: ProtocolConnection,
 *       state: 'busy' | 'ready',
 *     }
 *   >,
 * }} DispatcherState
 */

/**
 * @param {Map<string, ProtocolConnection>} follower_connections
 * @param {SharedSessionContext} shared_context
 * @returns {DispatcherState}
 */
function createDispatcherState(follower_connections, shared_context) {
  return {
    active_assignments: new Map(),
    follower_connections,
    scheduling_requested: false,
    scheduling_running: false,
    workers: new Map([
      [
        shared_context.worker_id,
        {
          kind: 'dispatcher',
          state: 'ready',
        },
      ],
    ]),
  };
}

/**
 * @param {DispatcherState} dispatcher_state
 * @param {ProtocolConnection} protocol_connection
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatcherConnection(
  dispatcher_state,
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
        dispatcher_state,
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
      dispatcher_state,
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
 * @param {DispatcherState} dispatcher_state
 * @param {{ source: string, type: 'notify_dispatch' }} notification_message
 * @param {ProtocolConnection} protocol_connection
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatchNotification(
  dispatcher_state,
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
  requestDispatcherScheduling(dispatcher_state, shared_context);
}

/**
 * @param {DispatcherState} dispatcher_state
 * @param {string} follower_id
 * @param {ProtocolConnection} protocol_connection
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function registerFollower(
  dispatcher_state,
  follower_id,
  protocol_connection,
  shared_context,
) {
  dispatcher_state.follower_connections.set(follower_id, protocol_connection);
  dispatcher_state.workers.set(follower_id, {
    kind: 'follower',
    protocol_connection,
    state: 'ready',
  });
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
    handleDispatcherFollowerMessage(message, shared_context, dispatcher_state),
  );
  requestDispatcherScheduling(dispatcher_state, shared_context);
  await protocol_connection.wait_until_closed();
  dispatcher_state.follower_connections.delete(follower_id);
  dispatcher_state.workers.delete(follower_id);
  const released_assignment_count = releaseWorkerAssignments(
    dispatcher_state,
    follower_id,
  );
  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} dispatcher] follower disconnected: ${follower_id}; released ${released_assignment_count} assignment${pluralize(released_assignment_count)} for reassignment`,
  );
  await shared_context.emit_event({
    kind: 'follower_disconnected',
    released_assignment_count,
    worker_id: follower_id,
  });
  requestDispatcherScheduling(dispatcher_state, shared_context);
}

/**
 * @param {import('./protocol.js').LocalDispatchMessage} message
 * @param {SharedSessionContext} shared_context
 * @param {ProtocolConnection | undefined} [protocol_connection]
 * @returns {Promise<void>}
 */
async function handleFollowerMessage(
  message,
  shared_context,
  protocol_connection,
) {
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

  if (protocol_connection === undefined) {
    return;
  }

  try {
    const run_result = await executeAssignedFlowInstance(
      message,
      /** @type {any} */ (shared_context),
    );

    if (run_result.outcome === 'failure') {
      protocol_connection.send({
        assignment_id: message.assignment_id,
        error: run_result.worker_error ?? 'Assignment failed.',
        type: 'assignment_failed',
        worker_id: shared_context.worker_id,
      });

      return;
    }

    if (run_result.outcome === 'pending-approval') {
      protocol_connection.send({
        assignment_id: message.assignment_id,
        type: 'assignment_pending_approval',
        worker_id: shared_context.worker_id,
      });

      return;
    }

    protocol_connection.send({
      assignment_id: message.assignment_id,
      type: 'assignment_completed',
      worker_id: shared_context.worker_id,
    });
  } catch (error) {
    protocol_connection.send({
      assignment_id: message.assignment_id,
      error: readErrorMessage(error),
      type: 'assignment_failed',
      worker_id: shared_context.worker_id,
    });
  }
}

/**
 * @param {import('./protocol.js').LocalDispatchMessage} message
 * @param {SharedSessionContext} shared_context
 * @param {DispatcherState | undefined} [dispatcher_state]
 * @returns {Promise<void>}
 */
async function handleDispatcherFollowerMessage(
  message,
  shared_context,
  dispatcher_state,
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
    requestDispatcherScheduling(dispatcher_state, shared_context);

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
    requestDispatcherScheduling(dispatcher_state, shared_context);

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
    requestDispatcherScheduling(dispatcher_state, shared_context);

    return;
  }

  throw new Error(`Unexpected dispatcher message ${message.type}.`);
}

/**
 * @param {DispatcherState | undefined} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @returns {void}
 */
function requestDispatcherScheduling(dispatcher_state, shared_context) {
  if (dispatcher_state === undefined) {
    return;
  }

  dispatcher_state.scheduling_requested = true;

  if (dispatcher_state.scheduling_running) {
    return;
  }

  dispatcher_state.scheduling_running = true;

  void runDispatcherScheduling(dispatcher_state, shared_context)
    .catch((error) => {
      reportOperatorError(shared_context.operator_io, error);
    })
    .finally(() => {
      dispatcher_state.scheduling_running = false;

      if (dispatcher_state.scheduling_requested) {
        requestDispatcherScheduling(dispatcher_state, shared_context);
      }
    });
}

/**
 * @param {DispatcherState} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function runDispatcherScheduling(dispatcher_state, shared_context) {
  while (dispatcher_state.scheduling_requested) {
    dispatcher_state.scheduling_requested = false;
    const pending_assignments = await materializePendingAssignments(
      /** @type {any} */ (shared_context),
    );
    const active_flow_instances = new Set(
      Array.from(dispatcher_state.active_assignments.values()).map(
        (assignment) => assignment.flow_instance_id,
      ),
    );
    const assignable_flow_instances = pending_assignments.filter(
      (assignment) => !active_flow_instances.has(assignment.flow_instance_id),
    );
    const ready_workers = Array.from(dispatcher_state.workers.entries()).filter(
      ([, worker_state]) => worker_state.state === 'ready',
    );

    for (
      let index = 0;
      index < ready_workers.length && index < assignable_flow_instances.length;
      index += 1
    ) {
      const [worker_id, worker_state] = ready_workers[index];
      const assignment = assignable_flow_instances[index];

      worker_state.state = 'busy';
      dispatcher_state.active_assignments.set(assignment.assignment_id, {
        flow_instance_id: assignment.flow_instance_id,
        worker_id,
      });
      shared_context.log_to_operator(
        `[worker ${shared_context.worker_id} dispatcher] dispatching ${assignment.flow_instance_id} (${assignment.assignment_id}) to ${worker_id}`,
      );
      await shared_context.emit_event({
        assignment_id: assignment.assignment_id,
        flow_instance_id: assignment.flow_instance_id,
        kind: 'assignment_dispatched',
        worker_id,
      });

      if (worker_state.kind === 'dispatcher') {
        void executeDispatcherAssignment(
          assignment,
          dispatcher_state,
          shared_context,
        );

        continue;
      }

      worker_state.protocol_connection?.send(assignment);
    }
  }
}

/**
 * @param {Extract<import('./protocol.js').LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {DispatcherState} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function executeDispatcherAssignment(
  assignment,
  dispatcher_state,
  shared_context,
) {
  try {
    const run_result = await executeAssignedFlowInstance(
      assignment,
      /** @type {any} */ (shared_context),
    );

    if (run_result.outcome === 'failure') {
      await handleDispatcherFollowerMessage(
        {
          assignment_id: assignment.assignment_id,
          error: run_result.worker_error ?? 'Assignment failed.',
          type: 'assignment_failed',
          worker_id: shared_context.worker_id,
        },
        shared_context,
        dispatcher_state,
      );

      return;
    }

    if (run_result.outcome === 'pending-approval') {
      await handleDispatcherFollowerMessage(
        {
          assignment_id: assignment.assignment_id,
          type: 'assignment_pending_approval',
          worker_id: shared_context.worker_id,
        },
        shared_context,
        dispatcher_state,
      );

      return;
    }

    await handleDispatcherFollowerMessage(
      {
        assignment_id: assignment.assignment_id,
        type: 'assignment_completed',
        worker_id: shared_context.worker_id,
      },
      shared_context,
      dispatcher_state,
    );
  } catch (error) {
    await handleDispatcherFollowerMessage(
      {
        assignment_id: assignment.assignment_id,
        error: readErrorMessage(error),
        type: 'assignment_failed',
        worker_id: shared_context.worker_id,
      },
      shared_context,
      dispatcher_state,
    );
  }
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

/**
 * @param {DispatcherState} dispatcher_state
 * @param {string} worker_id
 * @returns {number}
 */
function releaseWorkerAssignments(dispatcher_state, worker_id) {
  let released_assignment_count = 0;

  for (const [
    assignment_id,
    active_assignment,
  ] of dispatcher_state.active_assignments) {
    if (active_assignment.worker_id === worker_id) {
      dispatcher_state.active_assignments.delete(assignment_id);
      released_assignment_count += 1;
    }
  }

  return released_assignment_count;
}
