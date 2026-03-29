/** @import { Server } from 'node:net' */
/* eslint-disable max-lines-per-function */
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('node:net');
  vi.doUnmock('../../shared/graph/resolve-graph-api.js');
  vi.doUnmock('./context.js');
  vi.doUnmock('./dispatcher.js');
  vi.doUnmock('./protocol.js');
});

it('covers the no-dispatcher branch in the extracted dispatch session module', async () => {
  const { dispatch } = await import('./session.js');
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
  const temp_directory = await mkdtemp('/tmp/pravaha-dispatch-');
  /** @type {Array<{ source: string, type: 'notify_dispatch' }>} */
  const received_messages = [];
  const {
    closeServer,
    createProtocolConnection,
    removeStaleUnixSocket,
    resolveDispatchEndpoint,
    waitForMessage,
  } = await import('./protocol.js');
  const endpoint = await resolveDispatchEndpoint(temp_directory, 'darwin');
  const response_messages = [
    {
      dispatcher_id: 'worker-dispatcher',
      type: 'dispatch_notified',
    },
    {
      dispatcher_id: 'worker-dispatcher',
      type: 'worker_registered',
    },
  ];
  const server = createServer((socket) => {
    const protocol_connection = createProtocolConnection(socket);

    void waitForMessage(
      protocol_connection,
      'Expected the dispatcher test server to receive notify_dispatch.',
    ).then((message) => {
      if (message.type !== 'notify_dispatch') {
        throw new Error(`Expected notify_dispatch, received ${message.type}.`);
      }

      received_messages.push(message);
      protocol_connection.send(
        /** @type {{ dispatcher_id: string, type: 'dispatch_notified' | 'worker_registered' }} */ (
          response_messages.shift()
        ),
      );
      protocol_connection.close();
    });
  });

  await new Promise((resolve) => {
    server.listen(endpoint.address, () => {
      resolve(undefined);
    });
  });

  try {
    const { dispatch } = await import('./session.js');

    await expect(
      dispatch(temp_directory, { platform: 'darwin' }),
    ).resolves.toEqual({
      dispatcher_available: true,
      dispatcher_id: 'worker-dispatcher',
      endpoint: endpoint.address,
      notification_delivered: true,
      outcome: 'success',
    });
    await expect(
      dispatch(temp_directory, { platform: 'darwin' }),
    ).rejects.toThrow(
      'Expected dispatch_notified, received worker_registered.',
    );

    expect(received_messages).toEqual([
      {
        source: 'dispatch-cli',
        type: 'notify_dispatch',
      },
      {
        source: 'dispatch-cli',
        type: 'notify_dispatch',
      },
    ]);
  } finally {
    await closeServer(server);
    await removeStaleUnixSocket(endpoint.address);
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('sends the requested flow instance id when dispatch is scoped explicitly', async () => {
  vi.resetModules();
  const temp_directory = await mkdtemp('/tmp/pravaha-dispatch-');
  /** @type {Array<{ flow_instance_id?: string, source: string, type: 'notify_dispatch' }>} */
  const received_messages = [];
  const {
    closeServer,
    createProtocolConnection,
    removeStaleUnixSocket,
    resolveDispatchEndpoint,
    waitForMessage,
  } = await import('./protocol.js');
  const endpoint = await resolveDispatchEndpoint(temp_directory, 'darwin');
  const server = createServer((socket) => {
    const protocol_connection = createProtocolConnection(socket);

    void waitForMessage(
      protocol_connection,
      'Expected the dispatcher test server to receive notify_dispatch.',
    ).then((message) => {
      if (message.type !== 'notify_dispatch') {
        throw new Error(`Expected notify_dispatch, received ${message.type}.`);
      }

      received_messages.push(message);
      protocol_connection.send({
        dispatcher_id: 'worker-dispatcher',
        type: 'dispatch_notified',
      });
      protocol_connection.close();
    });
  });

  await new Promise((resolve) => {
    server.listen(endpoint.address, () => {
      resolve(undefined);
    });
  });

  try {
    const { dispatch } = await import('./session.js');

    await expect(
      dispatch(temp_directory, {
        flow_instance_id: 'flow-instance:1234',
        platform: 'darwin',
      }),
    ).resolves.toEqual({
      dispatcher_available: true,
      dispatcher_id: 'worker-dispatcher',
      endpoint: endpoint.address,
      notification_delivered: true,
      outcome: 'success',
    });

    expect(received_messages).toEqual([
      {
        flow_instance_id: 'flow-instance:1234',
        source: 'dispatch-cli',
        type: 'notify_dispatch',
      },
    ]);
  } finally {
    await closeServer(server);
    await removeStaleUnixSocket(endpoint.address);
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('covers tryListen success and address-in-use outcomes in the extracted dispatch session module', async () => {
  const { tryListen } = await import('./listen.js');
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
  const { tryListen } = await import('./listen.js');
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
