import { beforeEach, expect, it, vi } from 'vitest';

const {
  announceWorkerStart,
  canConnectToDispatcher,
  handleFollowerMessage,
  isTransientFollowerRegistrationError,
  openProtocolConnection,
  registerAbort,
  tryListen,
  waitForMessage,
  waitForRetryInterval,
} = vi.hoisted(() => {
  return {
    announceWorkerStart: vi.fn(),
    canConnectToDispatcher: vi.fn(),
    handleFollowerMessage: vi.fn(),
    isTransientFollowerRegistrationError: vi.fn(),
    openProtocolConnection: vi.fn(),
    registerAbort: vi.fn(),
    tryListen: vi.fn(),
    waitForMessage: vi.fn(),
    waitForRetryInterval: vi.fn(),
  };
});

vi.mock('./context.js', async () => {
  const actual = await vi.importActual('./context.js');

  return {
    ...actual,
    isTransientFollowerRegistrationError,
    registerAbort,
    waitForRetryInterval,
  };
});

vi.mock('./dispatcher.js', async () => {
  const actual = await vi.importActual('./dispatcher.js');

  return {
    ...actual,
    handleFollowerMessage,
  };
});

vi.mock('./listen.js', async () => {
  const actual = await vi.importActual('./listen.js');

  return {
    ...actual,
    tryListen,
  };
});

vi.mock('./protocol.js', async () => {
  const actual = await vi.importActual('./protocol.js');

  return {
    ...actual,
    canConnectToDispatcher,
    openProtocolConnection,
    waitForMessage,
  };
});

vi.mock('./worker-start-event.js', () => ({
  announceWorkerStart,
}));

const { acquireWorkerRoleSession } = await import('./worker-role-session.js');

beforeEach(() => {
  announceWorkerStart.mockReset();
  canConnectToDispatcher.mockReset();
  handleFollowerMessage.mockReset();
  isTransientFollowerRegistrationError.mockReset();
  openProtocolConnection.mockReset();
  registerAbort.mockReset();
  tryListen.mockReset();
  waitForMessage.mockReset();
  waitForRetryInterval.mockReset();

  announceWorkerStart.mockResolvedValue(undefined);
  canConnectToDispatcher.mockResolvedValue(true);
  handleFollowerMessage.mockResolvedValue(undefined);
  isTransientFollowerRegistrationError.mockReturnValue(false);
  registerAbort.mockImplementation((signal, handler) => {
    void signal;
    void handler;
  });
  tryListen.mockResolvedValue(false);
  waitForRetryInterval.mockResolvedValue(undefined);
});

it('retries transient follower registration errors and allows repeated shutdown', async () => {
  const { abort_handlers, protocol_connection } =
    configureRetryingFollowerRegistration();

  const session = await acquireWorkerRoleSession(
    {
      address: '/tmp/dispatch.sock',
      kind: 'unix-socket',
    },
    createSharedContext(),
    createStopContext(),
  );

  expect(session).toMatchObject({
    dispatcher_id: 'worker-dispatcher',
    endpoint: '/tmp/dispatch.sock',
    role: 'follower',
    worker_id: 'worker-follower',
  });
  expect(protocol_connection.send).toHaveBeenCalledTimes(2);
  expect(abort_handlers).toHaveLength(1);

  await abort_handlers[0]();
  await abort_handlers[0]();

  expect(protocol_connection.close).toHaveBeenCalledTimes(1);
  expect(protocol_connection.destroy).toHaveBeenCalledTimes(1);
});

it('rejects missing follower protocol connections', async () => {
  openProtocolConnection.mockResolvedValue(null);

  await expect(
    acquireWorkerRoleSession(
      {
        address: '/tmp/dispatch.sock',
        kind: 'unix-socket',
      },
      createSharedContext(),
      createStopContext(),
    ),
  ).rejects.toThrow(
    'Expected a live dispatcher to accept follower registration.',
  );
});

it('rejects unexpected follower registration acknowledgements', async () => {
  const protocol_connection = createMockProtocolConnection();

  openProtocolConnection.mockResolvedValue(protocol_connection);
  waitForMessage.mockResolvedValue({
    dispatcher_id: 'worker-dispatcher',
    type: 'dispatch_notified',
  });

  await expect(
    acquireWorkerRoleSession(
      {
        address: '/tmp/dispatch.sock',
        kind: 'unix-socket',
      },
      createSharedContext(),
      createStopContext(),
    ),
  ).rejects.toThrow('Expected worker_registered, received dispatch_notified.');
});

function createSharedContext() {
  return {
    emit_event() {
      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    log_to_operator() {},
    signal: undefined,
    worker_id: 'worker-follower',
  };
}

function createStopContext() {
  /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
  let resolve;
  /** @type {Promise<void>} */
  const stopped = new Promise((resolved) => {
    resolve = resolved;
  });

  return {
    resolve: /** @type {() => void} */ (/** @type {unknown} */ (resolve)),
    stopped,
    stopped_requested: false,
  };
}

function createMockProtocolConnection() {
  /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
  let resolveClosed;
  /** @type {Promise<void>} */
  const closed = new Promise((resolved) => {
    resolveClosed = resolved;
  });

  return {
    close: vi.fn(() => {
      /** @type {() => void} */ (resolveClosed)();
    }),
    destroy: vi.fn(),
    send: vi.fn(),
    setMessageHandler: vi.fn(),
    wait_until_closed: vi.fn(() => closed),
  };
}

function configureRetryingFollowerRegistration() {
  /** @type {Array<() => Promise<void>>} */
  const abort_handlers = [];
  const transient_error = new Error('transient');
  const protocol_connection = createMockProtocolConnection();
  let wait_for_message_count = 0;

  openProtocolConnection.mockResolvedValue(protocol_connection);
  isTransientFollowerRegistrationError.mockImplementation(
    (error) => error === transient_error,
  );
  registerAbort.mockImplementation((signal, handler) => {
    void signal;
    abort_handlers.push(toAbortHandler(handler));
  });
  waitForMessage.mockImplementation(() => {
    wait_for_message_count += 1;

    if (wait_for_message_count === 1) {
      return Promise.reject(transient_error);
    }

    return Promise.resolve({
      dispatcher_id: 'worker-dispatcher',
      type: 'worker_registered',
    });
  });

  return {
    abort_handlers,
    protocol_connection,
  };
}

/**
 * @param {unknown} value
 * @returns {() => Promise<void>}
 */
function toAbortHandler(value) {
  return /** @type {() => Promise<void>} */ (value);
}
