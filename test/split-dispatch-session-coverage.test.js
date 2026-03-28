/** @import { Server } from 'node:net' */
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('node:net');
  vi.doUnmock('../lib/reconcile-graph.js');
  vi.doUnmock('../lib/runtime/dispatch/context.js');
  vi.doUnmock('../lib/runtime/dispatch/dispatcher.js');
  vi.doUnmock('../lib/runtime/dispatch/protocol.js');
});

it('covers the no-dispatcher branch in the extracted dispatch session module', async () => {
  const { dispatch } = await import('../lib/runtime/dispatch/session.js');
  const temp_directory = await mkdtemp('/tmp/pravaha-dispatch-');

  try {
    await expect(dispatch(temp_directory)).resolves.toEqual({
      dispatcher_available: false,
      dispatcher_id: null,
      endpoint: join(temp_directory, '.pravaha/dispatch/leader.sock'),
      notification_delivered: false,
      outcome: 'success',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('covers notify delivery and unexpected acknowledgements in the extracted dispatch session module', async () => {
  vi.resetModules();
  const protocol_mocks = mockDispatchProtocolSequence([
    {
      dispatcher_id: 'worker-dispatcher',
      type: 'dispatch_notified',
    },
    {
      dispatcher_id: 'worker-dispatcher',
      type: 'worker_registered',
    },
  ]);
  const { dispatch } = await import('../lib/runtime/dispatch/session.js');

  await expect(dispatch('/repo')).resolves.toEqual({
    dispatcher_available: true,
    dispatcher_id: 'worker-dispatcher',
    endpoint: '/repo/.pravaha/dispatch/leader.sock',
    notification_delivered: true,
    outcome: 'success',
  });
  await expect(dispatch('/repo')).rejects.toThrow(
    'Expected dispatch_notified, received worker_registered.',
  );

  expect(protocol_mocks.send).toHaveBeenCalledWith({
    source: 'dispatch-cli',
    type: 'notify_dispatch',
  });
  expect(protocol_mocks.close).toHaveBeenCalledTimes(1);
  expect(protocol_mocks.destroy).toHaveBeenCalledTimes(2);
  expect(protocol_mocks.wait_until_closed).toHaveBeenCalledTimes(1);
});

it('covers tryListen success and address-in-use outcomes in the extracted dispatch session module', async () => {
  const { tryListen } = await import('../lib/runtime/dispatch/session.js');
  const successful_server = createMockListenServer();
  const busy_server = createMockListenServer({
    error: Object.assign(new Error('busy'), {
      code: 'EADDRINUSE',
    }),
  });

  await expect(
    tryListen(
      /** @type {Server} */ (/** @type {unknown} */ (successful_server)),
      '/repo/socket',
    ),
  ).resolves.toBe(true);
  await expect(
    tryListen(
      /** @type {Server} */ (/** @type {unknown} */ (busy_server)),
      '/repo/socket',
    ),
  ).resolves.toBe(false);
});

it('rethrows unexpected listen errors in the extracted dispatch session module', async () => {
  const { tryListen } = await import('../lib/runtime/dispatch/session.js');
  const failing_server = createMockListenServer({
    error: new Error('listen boom'),
  });

  await expect(
    tryListen(
      /** @type {Server} */ (/** @type {unknown} */ (failing_server)),
      '/repo/socket',
    ),
  ).rejects.toThrow('listen boom');
});

/**
 * @param {Array<{ dispatcher_id: string, type: 'dispatch_notified' | 'worker_registered' }>} response_messages
 * @returns {{
 *   close: ReturnType<typeof vi.fn>,
 *   destroy: ReturnType<typeof vi.fn>,
 *   send: ReturnType<typeof vi.fn>,
 *   wait_until_closed: ReturnType<typeof vi.fn>,
 * }}
 */
function mockDispatchProtocolSequence(response_messages) {
  const send = vi.fn();
  const close = vi.fn();
  const destroy = vi.fn();
  const wait_until_closed = vi.fn(async () => {});
  const wait_for_message = vi.fn();

  for (const response_message of response_messages) {
    wait_for_message.mockResolvedValueOnce(response_message);
  }

  vi.doMock('../lib/runtime/dispatch/protocol.js', () => ({
    canConnectToDispatcher: vi.fn(),
    closeServer: vi.fn(),
    createProtocolConnection: vi.fn(),
    isAddressInUseError: vi.fn(),
    openProtocolConnection: vi.fn(async () => ({
      close,
      destroy,
      send,
      wait_until_closed,
    })),
    removeStaleUnixSocket: vi.fn(),
    reportOperatorError: vi.fn(),
    resolveDispatchEndpoint: vi.fn(async () => ({
      address: '/repo/.pravaha/dispatch/leader.sock',
      kind: 'unix-socket',
    })),
    waitForMessage: wait_for_message,
  }));

  return {
    close,
    destroy,
    send,
    wait_until_closed,
  };
}

/**
 * @param {{ error?: Error }} [options]
 * @returns {{
 *   listen: (endpoint_address: string, on_listen: () => void) => void,
 *   off: (event_name: 'error', listener: (error: Error) => void) => EventEmitter,
 *   once: (event_name: 'error', listener: (error: Error) => void) => EventEmitter,
 * }}
 */
function createMockListenServer(options = {}) {
  const emitter = new EventEmitter();

  return {
    listen(endpoint_address, on_listen) {
      void endpoint_address;

      if (options.error !== undefined) {
        emitter.emit('error', options.error);

        return;
      }

      on_listen();
    },
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
  };
}
