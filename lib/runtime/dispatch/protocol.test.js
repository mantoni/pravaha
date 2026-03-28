/* eslint-disable max-lines-per-function */
// @module-tag lint-staged-excluded

import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  canConnectToDispatcher,
  closeServer,
  createProtocolConnection,
  isAddressInUseError,
  isInitialProbeDisconnect,
  openProtocolConnection,
  parseProtocolMessage,
  removeStaleUnixSocket,
  reportOperatorError,
  resolveDispatchEndpoint,
  waitForMessage,
} from './protocol.js';

it('resolves unix and windows endpoints and removes stale unix socket files', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const unix_endpoint = await resolveDispatchEndpoint(temp_directory, 'darwin');
  const windows_endpoint = await resolveDispatchEndpoint(
    temp_directory,
    'win32',
  );

  try {
    expect(unix_endpoint).toMatchObject({
      address: expect.stringContaining('.pravaha/dispatch/leader.sock'),
      kind: 'unix-socket',
    });
    expect(windows_endpoint).toMatchObject({
      address: expect.stringContaining('\\\\.\\pipe\\pravaha-'),
      kind: 'named-pipe',
    });

    await writeFile(unix_endpoint.address, 'stale');
    await removeStaleUnixSocket(unix_endpoint.address);

    await expect(access(unix_endpoint.address)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('detects missing and live dispatch endpoints', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const server = createServer();

  try {
    await expect(openProtocolConnection(endpoint.address)).resolves.toBeNull();
    await expect(canConnectToDispatcher(endpoint.address)).resolves.toBe(false);

    await listen(server, endpoint.address);

    await expect(canConnectToDispatcher(endpoint.address)).resolves.toBe(true);
  } finally {
    await closeServer(server);
    if (endpoint.kind === 'unix-socket') {
      await removeStaleUnixSocket(endpoint.address);
    }

    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('parses the supported protocol messages and rejects unknown payloads', () => {
  expect(
    parseProtocolMessage('{"type":"register_worker","worker_id":"worker-a"}'),
  ).toEqual({
    type: 'register_worker',
    worker_id: 'worker-a',
  });
  expect(
    parseProtocolMessage(
      '{"type":"worker_registered","dispatcher_id":"worker-a"}',
    ),
  ).toEqual({
    dispatcher_id: 'worker-a',
    type: 'worker_registered',
  });
  expect(
    parseProtocolMessage('{"type":"notify_dispatch","source":"dispatch-cli"}'),
  ).toEqual({
    source: 'dispatch-cli',
    type: 'notify_dispatch',
  });
  expect(
    parseProtocolMessage(
      '{"type":"dispatch_notified","dispatcher_id":"worker-a"}',
    ),
  ).toEqual({
    dispatcher_id: 'worker-a',
    type: 'dispatch_notified',
  });
  expect(
    parseProtocolMessage(
      '{"type":"assignment","assignment_id":"run-1","flow_instance_id":"flow-1"}',
    ),
  ).toEqual({
    assignment_id: 'run-1',
    flow_instance_id: 'flow-1',
    type: 'assignment',
  });
  expect(
    parseProtocolMessage(
      '{"type":"assignment_pending_approval","assignment_id":"run-1","worker_id":"worker-a"}',
    ),
  ).toEqual({
    assignment_id: 'run-1',
    type: 'assignment_pending_approval',
    worker_id: 'worker-a',
  });
  expect(
    parseProtocolMessage(
      '{"type":"assignment_completed","assignment_id":"run-1","worker_id":"worker-a"}',
    ),
  ).toEqual({
    assignment_id: 'run-1',
    type: 'assignment_completed',
    worker_id: 'worker-a',
  });
  expect(
    parseProtocolMessage(
      '{"type":"assignment_failed","assignment_id":"run-1","worker_id":"worker-a","error":"boom"}',
    ),
  ).toEqual({
    assignment_id: 'run-1',
    error: 'boom',
    type: 'assignment_failed',
    worker_id: 'worker-a',
  });
  expect(() => parseProtocolMessage('{"type":"unknown"}')).toThrow(
    'Unsupported local dispatch message',
  );
});

it('queues protocol messages, flushes handlers, and rejects pending reads when the socket closes', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const server = createServer();
  /** @type {any} */
  let server_connection = null;
  /** @type {Array<Record<string, unknown>>} */
  const handled_messages = [];

  try {
    server.on('connection', (socket) => {
      server_connection = createProtocolConnection(socket);
    });
    await listen(server, endpoint.address);

    const client_connection = await openProtocolConnection(endpoint.address);

    if (client_connection === null) {
      throw new Error('Expected a live protocol connection.');
    }

    await waitForCondition(() => server_connection !== null);
    const connected_server = server_connection;

    if (connected_server === null) {
      throw new Error('Expected a server-side protocol connection.');
    }

    connected_server.send({
      dispatcher_id: 'worker-dispatcher',
      type: 'dispatch_notified',
    });

    await expect(
      waitForMessage(client_connection, 'Expected queued protocol message.'),
    ).resolves.toEqual({
      dispatcher_id: 'worker-dispatcher',
      type: 'dispatch_notified',
    });

    client_connection.setMessageHandler((message) => {
      handled_messages.push(message);
    });
    connected_server.send({
      source: 'dispatch-cli',
      type: 'notify_dispatch',
    });

    await waitForCondition(() => handled_messages.length === 1);

    const pending_message = client_connection.nextMessage();

    connected_server.close();
    connected_server.destroy();

    await expect(pending_message).rejects.toThrow(
      'The local dispatch connection closed before a message arrived.',
    );
  } finally {
    await closeServer(server);
    if (endpoint.kind === 'unix-socket') {
      await removeStaleUnixSocket(endpoint.address);
    }

    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports operator-visible protocol errors and recognizes known error shapes', () => {
  const io_context = createIoContext();

  reportOperatorError(io_context, new Error('protocol boom'));
  reportOperatorError(undefined, 'ignored');

  expect(io_context.stderr_text()).toBe('protocol boom\n');
  expect(
    isAddressInUseError(
      Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }),
    ),
  ).toBe(true);
  expect(isAddressInUseError(new Error('other'))).toBe(false);
  expect(
    isInitialProbeDisconnect(
      new Error(
        'Expected the client to send an initial local dispatch message.',
        {
          cause: new Error(
            'The local dispatch connection closed before a message arrived.',
          ),
        },
      ),
    ),
  ).toBe(true);
  expect(isInitialProbeDisconnect(new Error('other'))).toBe(false);
  expect(isInitialProbeDisconnect('other')).toBe(false);
});

it('wraps protocol read failures with the provided context message', async () => {
  await expect(
    waitForMessage(
      /** @type {any} */ ({
        close() {},
        destroy() {},
        async nextMessage() {
          throw new Error('boom');
        },
        send() {},
        setMessageHandler() {},
        async wait_until_closed() {},
      }),
      'Expected wrapped error.',
    ),
  ).rejects.toThrow('Expected wrapped error.');
});

/**
 * @param {import('node:net').Server} server
 * @param {string} endpoint_address
 * @returns {Promise<void>}
 */
async function listen(server, endpoint_address) {
  await new Promise((resolve_listen, reject_listen) => {
    server.once('error', reject_listen);
    server.listen(endpoint_address, () => {
      server.off('error', reject_listen);
      resolve_listen(undefined);
    });
  });
}

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout: { write(chunk: string): boolean },
 * }}
 */
function createIoContext() {
  let stderr = '';

  return {
    stderr: {
      write(chunk) {
        stderr += chunk;

        return true;
      },
    },
    stderr_text() {
      return stderr;
    },
    stdout: {
      write() {
        return true;
      },
    },
  };
}

/**
 * @param {() => boolean} predicate
 * @returns {Promise<void>}
 */
async function waitForCondition(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out while waiting for the protocol condition.');
}
