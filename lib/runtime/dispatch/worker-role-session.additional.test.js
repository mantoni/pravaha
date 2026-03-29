import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('./context.js');
  vi.doUnmock('./dispatcher.js');
  vi.doUnmock('./protocol.js');
  vi.doUnmock('./worker-start-event.js');
});

it('retries transient follower registration errors and allows repeated shutdown', async () => {
  const { abort_handlers, protocol_connection } =
    mockRetryingFollowerRegistration();
  const { acquireWorkerRoleSession } = await import('./worker-role-session.js');
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
  mockFollowerSessionSupport();
  vi.doMock('./context.js', async () => {
    const actual = await vi.importActual('./context.js');

    return {
      ...actual,
      isTransientFollowerRegistrationError: vi.fn(() => false),
    };
  });
  vi.doMock('./protocol.js', async () => {
    const actual = await vi.importActual('./protocol.js');

    return {
      ...actual,
      canConnectToDispatcher: vi.fn(async () => true),
      openProtocolConnection: vi.fn(async () => null),
    };
  });

  const { acquireWorkerRoleSession } = await import('./worker-role-session.js');

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

  mockFollowerSessionSupport();
  vi.doMock('./protocol.js', async () => {
    const actual = await vi.importActual('./protocol.js');

    return {
      ...actual,
      canConnectToDispatcher: vi.fn(async () => true),
      openProtocolConnection: vi.fn(async () => protocol_connection),
      waitForMessage: vi.fn(async () => ({
        dispatcher_id: 'worker-dispatcher',
        type: 'dispatch_notified',
      })),
    };
  });

  const { acquireWorkerRoleSession } = await import('./worker-role-session.js');

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
    async emit_event() {},
    endpoint: '/tmp/dispatch.sock',
    log_to_operator() {},
    signal: undefined,
    worker_id: 'worker-follower',
  };
}

function createStopContext() {
  /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
  let resolve;
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
  let resolve_closed;
  const closed = new Promise((resolved) => {
    resolve_closed = resolved;
  });

  return {
    close: vi.fn(() => {
      /** @type {() => void} */ (resolve_closed)();
    }),
    destroy: vi.fn(),
    send: vi.fn(),
    setMessageHandler: vi.fn(),
    wait_until_closed: vi.fn(() => closed),
  };
}

function mockRetryingFollowerRegistration() {
  /** @type {Array<() => Promise<void>>} */
  const abort_handlers = [];
  const transient_error = new Error('transient');
  const protocol_connection = createMockProtocolConnection();
  let wait_for_message_count = 0;

  mockFollowerSessionSupport();
  vi.doMock('./context.js', async () => {
    const actual = await vi.importActual('./context.js');

    return {
      ...actual,
      isTransientFollowerRegistrationError: vi.fn(
        (error) => error === transient_error,
      ),
      registerAbort: vi.fn((_signal, on_abort) => {
        abort_handlers.push(on_abort);
      }),
      waitForRetryInterval: vi.fn(async () => {}),
    };
  });
  vi.doMock('./protocol.js', async () => {
    const actual = await vi.importActual('./protocol.js');

    return {
      ...actual,
      canConnectToDispatcher: vi.fn(async () => true),
      openProtocolConnection: vi.fn(async () => protocol_connection),
      waitForMessage: vi.fn(async () => {
        wait_for_message_count += 1;

        if (wait_for_message_count === 1) {
          throw transient_error;
        }

        return {
          dispatcher_id: 'worker-dispatcher',
          type: 'worker_registered',
        };
      }),
    };
  });

  return {
    abort_handlers,
    protocol_connection,
  };
}

function mockFollowerSessionSupport() {
  vi.doMock('./dispatcher.js', async () => {
    const actual = await vi.importActual('./dispatcher.js');

    return {
      ...actual,
      handleFollowerMessage: vi.fn(async () => {}),
    };
  });
  vi.doMock('./worker-start-event.js', () => ({
    announceWorkerStart: vi.fn(async () => {}),
  }));
}
