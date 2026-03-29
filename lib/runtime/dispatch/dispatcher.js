/**
 * @import { GraphApi, ProjectGraphResult } from '../../shared/types/patram-types.ts'
 * @import { LocalDispatchMessage } from './protocol.js'
 */
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
import { handleDispatcherFollowerMessage } from './follower-message.js';

export {
  createDispatcherState,
  handleDispatcherConnection,
  handleFollowerMessage,
  requestDispatcherScheduling,
};

/**
 * @typedef {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<LocalDispatchMessage>,
 *   send: (message: LocalDispatchMessage) => void,
 *   setMessageHandler: (
 *     message_handler: (message: LocalDispatchMessage) => void | Promise<void>,
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
 *   explicit_assignments: Map<
 *     string,
 *     Extract<LocalDispatchMessage, { type: 'assignment' }>
 *   >,
 *   explicit_assignment_waiters: Map<string, ProtocolConnection>,
 *   follower_connections: Map<string, ProtocolConnection>,
 *   requested_flow_instance_ids: Set<string>,
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
    explicit_assignments: new Map(),
    explicit_assignment_waiters: new Map(),
    follower_connections,
    requested_flow_instance_ids: new Set(),
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

    if (first_message.type === 'dispatch_assignment') {
      await handleDispatchAssignment(
        dispatcher_state,
        first_message,
        protocol_connection,
        shared_context,
      );

      return;
    }

    if (first_message.type !== 'register_worker') {
      throw new Error(
        `Expected register_worker, notify_dispatch, or dispatch_assignment, received ${first_message.type}.`,
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
 * @param {{ flow_instance_id?: string, source: string, type: 'notify_dispatch' }} notification_message
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
    `[worker ${shared_context.worker_id} dispatcher] notify received from ${notification_message.source}${typeof notification_message.flow_instance_id === 'string' ? ` for ${notification_message.flow_instance_id}` : ''}`,
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
  requestDispatcherScheduling(dispatcher_state, shared_context, {
    flow_instance_id: notification_message.flow_instance_id,
  });
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
    handleDispatcherFollowerMessage(
      message,
      shared_context,
      dispatcher_state,
      requestDispatcherScheduling,
    ),
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
 * @param {DispatcherState} dispatcher_state
 * @param {Extract<LocalDispatchMessage, { type: 'dispatch_assignment' }>} assignment_message
 * @param {ProtocolConnection} protocol_connection
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function handleDispatchAssignment(
  dispatcher_state,
  assignment_message,
  protocol_connection,
  shared_context,
) {
  const assignment = createExplicitAssignment(assignment_message);

  shared_context.log_to_operator(
    `[worker ${shared_context.worker_id} dispatcher] explicit assignment received from ${assignment_message.source}: ${assignment.flow_instance_id} (${assignment.assignment_id})`,
  );
  await shared_context.emit_event({
    assignment_id: assignment.assignment_id,
    flow_instance_id: assignment.flow_instance_id,
    kind: 'assignment_requested',
    source: assignment_message.source,
  });
  dispatcher_state.explicit_assignments.set(
    assignment.assignment_id,
    assignment,
  );
  dispatcher_state.explicit_assignment_waiters.set(
    assignment.assignment_id,
    protocol_connection,
  );
  void protocol_connection.wait_until_closed().finally(() => {
    cleanupExplicitAssignment(dispatcher_state, assignment.assignment_id);
  });
  requestDispatcherScheduling(dispatcher_state, shared_context);
}

/**
 * @param {LocalDispatchMessage} message
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

    if (
      run_result.outcome === 'pending-approval' ||
      run_result.outcome === 'pending-queue'
    ) {
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
 * @param {DispatcherState | undefined} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @param {{ flow_instance_id?: string }} [options]
 * @returns {void}
 */
function requestDispatcherScheduling(
  dispatcher_state,
  shared_context,
  options = {},
) {
  if (dispatcher_state === undefined) {
    return;
  }

  if (typeof options.flow_instance_id === 'string') {
    dispatcher_state.requested_flow_instance_ids.add(options.flow_instance_id);
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
    const pending_assignments = await readPendingAssignmentsForScheduling(
      dispatcher_state,
      shared_context,
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
      await dispatchAssignmentToWorker(
        ready_workers[index],
        assignable_flow_instances[index],
        dispatcher_state,
        shared_context,
      );
    }
  }
}

/**
 * @param {DispatcherState} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<Array<Extract<LocalDispatchMessage, { type: 'assignment' }>>>}
 */
async function readPendingAssignmentsForScheduling(
  dispatcher_state,
  shared_context,
) {
  const selected_flow_instance_ids =
    dispatcher_state.requested_flow_instance_ids.size === 0
      ? undefined
      : new Set(dispatcher_state.requested_flow_instance_ids);

  dispatcher_state.requested_flow_instance_ids.clear();
  const pending_assignments = await materializePendingAssignments(
    /** @type {any} */ (shared_context),
    {
      explicit_flow_instance_ids: selected_flow_instance_ids,
      selected_flow_instance_ids,
    },
  );
  const explicit_assignments = Array.from(
    dispatcher_state.explicit_assignments.values(),
  );

  if (selected_flow_instance_ids !== undefined) {
    logUnmatchedExplicitFlowInstances(
      selected_flow_instance_ids,
      [...explicit_assignments, ...pending_assignments],
      shared_context,
    );
  }

  return [...explicit_assignments, ...pending_assignments];
}

/**
 * @param {[string, DispatcherState['workers'] extends Map<string, infer T> ? T : never]} ready_worker
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {DispatcherState} dispatcher_state
 * @param {SharedSessionContext} shared_context
 * @returns {Promise<void>}
 */
async function dispatchAssignmentToWorker(
  ready_worker,
  assignment,
  dispatcher_state,
  shared_context,
) {
  const [worker_id, worker_state] = ready_worker;

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

    return;
  }

  worker_state.protocol_connection?.send(assignment);
}

/**
 * @param {Set<string>} selected_flow_instance_ids
 * @param {Array<Extract<LocalDispatchMessage, { type: 'assignment' }>>} pending_assignments
 * @param {SharedSessionContext} shared_context
 * @returns {void}
 */
function logUnmatchedExplicitFlowInstances(
  selected_flow_instance_ids,
  pending_assignments,
  shared_context,
) {
  const materialized_flow_instance_ids = new Set(
    pending_assignments.map((assignment) => assignment.flow_instance_id),
  );

  for (const flow_instance_id of selected_flow_instance_ids) {
    if (materialized_flow_instance_ids.has(flow_instance_id)) {
      continue;
    }

    shared_context.log_to_operator(
      `[worker ${shared_context.worker_id} dispatcher] explicit flow instance ${flow_instance_id} does not currently match authoritative state; nothing scheduled`,
    );
  }
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
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
    await handleDispatcherFollowerMessage(
      createDispatcherAssignmentMessage(
        assignment,
        run_result,
        shared_context.worker_id,
      ),
      shared_context,
      dispatcher_state,
      requestDispatcherScheduling,
    );
  } catch (error) {
    await handleDispatcherFollowerMessage(
      createDispatcherAssignmentFailureMessage(
        assignment,
        readErrorMessage(error),
        shared_context.worker_id,
      ),
      shared_context,
      dispatcher_state,
      requestDispatcherScheduling,
    );
  }
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'dispatch_assignment' }>} assignment_message
 * @returns {Extract<LocalDispatchMessage, { type: 'assignment' }>}
 */
function createExplicitAssignment(assignment_message) {
  return {
    assignment_id: assignment_message.assignment_id,
    binding_targets: assignment_message.binding_targets,
    contract_path: assignment_message.contract_path,
    decision_paths: assignment_message.decision_paths,
    flow_id: assignment_message.flow_id,
    flow_instance_id: assignment_message.flow_instance_id,
    flow_path: assignment_message.flow_path,
    ordered_jobs: assignment_message.ordered_jobs,
    start_job_name: assignment_message.start_job_name,
    task_id: assignment_message.task_id,
    task_path: assignment_message.task_path,
    type: 'assignment',
    workspace: assignment_message.workspace,
  };
}

/**
 * @param {DispatcherState} dispatcher_state
 * @param {string} assignment_id
 * @returns {void}
 */
function cleanupExplicitAssignment(dispatcher_state, assignment_id) {
  dispatcher_state.explicit_assignments.delete(assignment_id);
  dispatcher_state.explicit_assignment_waiters.delete(assignment_id);
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {Awaited<ReturnType<typeof executeAssignedFlowInstance>>} run_result
 * @param {string} worker_id
 * @returns {Extract<
 *   LocalDispatchMessage,
 *   | { type: 'assignment_completed' }
 *   | { type: 'assignment_failed' }
 *   | { type: 'assignment_pending_approval' }
 * >}
 */
function createDispatcherAssignmentMessage(assignment, run_result, worker_id) {
  if (run_result.outcome === 'failure') {
    return createDispatcherAssignmentFailureMessage(
      assignment,
      run_result.worker_error ?? 'Assignment failed.',
      worker_id,
    );
  }

  if (
    run_result.outcome === 'pending-approval' ||
    run_result.outcome === 'pending-queue'
  ) {
    return {
      assignment_id: assignment.assignment_id,
      type: 'assignment_pending_approval',
      worker_id,
    };
  }

  return {
    assignment_id: assignment.assignment_id,
    type: 'assignment_completed',
    worker_id,
  };
}

/**
 * @param {Extract<LocalDispatchMessage, { type: 'assignment' }>} assignment
 * @param {string} error
 * @param {string} worker_id
 * @returns {Extract<LocalDispatchMessage, { type: 'assignment_failed' }>}
 */
function createDispatcherAssignmentFailureMessage(
  assignment,
  error,
  worker_id,
) {
  return {
    assignment_id: assignment.assignment_id,
    error,
    type: 'assignment_failed',
    worker_id,
  };
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
