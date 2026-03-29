import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('./assignments.js');
  vi.doUnmock('./follower-message.js');
});

it('reports dispatcher-local assignment failures', async () => {
  await expectDispatcherFailure({
    assignment_id: 'assignment-1',
    error: 'run failed',
    execute_assigned_flow_instance: () =>
      Promise.resolve({
        outcome: 'failure',
        worker_error: 'run failed',
      }),
    flow_instance_id: 'flow-1',
  });
  await expectDispatcherFailure({
    assignment_id: 'assignment-2',
    error: 'crash',
    execute_assigned_flow_instance: () => Promise.reject(new Error('crash')),
    flow_instance_id: 'flow-2',
  });
});

it('reports dispatcher status with connected workers and active assignments', async () => {
  vi.resetModules();
  const { createDispatcherState, handleDispatcherConnection } =
    await import('./dispatcher.js');
  const shared_context = createSharedContext();
  const dispatcher_state = createDispatcherState(new Map(), shared_context);
  /** @type {Record<string, unknown>[]} */
  const sent_messages = [];
  const protocol_connection = createProtocolConnection({
    initial_message: {
      type: 'status_request',
    },
    sent_messages,
  });

  dispatcher_state.workers.set('worker-helper', {
    kind: 'follower',
    state: 'busy',
  });
  dispatcher_state.active_assignments.set('assignment-1', {
    flow_instance_id: 'flow-instance:1',
    worker_id: 'worker-helper',
  });

  await handleDispatcherConnection(
    dispatcher_state,
    /** @type {any} */ (protocol_connection),
    shared_context,
  );

  expect(sent_messages).toEqual([
    {
      active_assignments: [
        {
          flow_instance_id: 'flow-instance:1',
          worker_id: 'worker-helper',
        },
      ],
      connected_worker_count: 2,
      dispatcher_id: 'worker-dispatcher',
      type: 'status_report',
    },
  ]);
});

function createSharedContext() {
  return {
    emit_event() {
      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    log_to_operator() {},
    now() {
      return new Date();
    },
    repo_directory: '/tmp/repo',
    worker_id: 'worker-dispatcher',
  };
}

/**
 * @param {{
 *   initial_message: Record<string, unknown>,
 *   sent_messages: Record<string, unknown>[],
 * }} options
 * @returns {{
 *   close: () => void,
 *   destroy: (error?: unknown) => void,
 *   nextMessage: () => Promise<Record<string, unknown>>,
 *   send: (message: Record<string, unknown>) => void,
 *   setMessageHandler: () => void,
 *   wait_until_closed: () => Promise<void>,
 * }}
 */
function createProtocolConnection(options) {
  let closed = false;

  return {
    close() {
      closed = true;
    },
    destroy() {
      closed = true;
    },
    nextMessage() {
      return Promise.resolve(options.initial_message);
    },
    send(message) {
      options.sent_messages.push(message);
    },
    setMessageHandler() {},
    wait_until_closed() {
      void closed;

      return Promise.resolve();
    },
  };
}

/**
 * @param {() => boolean} predicate
 * @returns {Promise<void>}
 */
async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Condition was not met before timeout.');
}

/**
 * @param {{
 *   assignment_id: string,
 *   error: string,
 *   execute_assigned_flow_instance: () => Promise<unknown>,
 *   flow_instance_id: string,
 * }} options
 * @returns {Promise<void>}
 */
async function expectDispatcherFailure(options) {
  vi.resetModules();
  /** @type {Array<Record<string, unknown>>} */
  const handled_messages = [];

  vi.doMock('./assignments.js', () => ({
    executeAssignedFlowInstance: vi.fn(options.execute_assigned_flow_instance),
    materializePendingAssignments: vi.fn(() =>
      Promise.resolve([
        {
          assignment_id: options.assignment_id,
          flow_instance_id: options.flow_instance_id,
          type: 'assignment',
        },
      ]),
    ),
  }));
  vi.doMock('./follower-message.js', () => ({
    handleDispatcherFollowerMessage: vi.fn((message) => {
      handled_messages.push(readMessageRecord(message));

      return Promise.resolve();
    }),
  }));

  const { createDispatcherState, requestDispatcherScheduling } =
    await import('./dispatcher.js');
  const shared_context = createSharedContext();
  const dispatcher_state = createDispatcherState(new Map(), shared_context);

  dispatcher_state.workers.set('worker-dispatcher', {
    kind: 'dispatcher',
    state: 'ready',
  });

  requestDispatcherScheduling(dispatcher_state, shared_context);
  await waitForCondition(() => handled_messages.length === 1);

  expect(handled_messages).toEqual([
    {
      assignment_id: options.assignment_id,
      error: options.error,
      type: 'assignment_failed',
      worker_id: 'worker-dispatcher',
    },
  ]);
}

/**
 * @param {unknown} message
 * @returns {Record<string, unknown>}
 */
function readMessageRecord(message) {
  if (
    message === null ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    throw new Error('Expected handled dispatcher message to be an object.');
  }

  return /** @type {Record<string, unknown>} */ (message);
}
