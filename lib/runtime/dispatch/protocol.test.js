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
  removeStaleUnixSocket,
  reportOperatorError,
  resolveDispatchEndpoint,
  waitForMessage,
} from './protocol.js';
import { parseProtocolMessage } from './protocol-message.js';

/**
 * @import { LocalDispatchMessage } from './protocol.js'
 */
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

it('resolves unix and windows endpoints and removes stale unix socket files', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const unix_endpoint = await resolveDispatchEndpoint(temp_directory, 'darwin');
  const windows_endpoint = await resolveDispatchEndpoint(
    temp_directory,
    'win32',
  );

  try {
    expect(unix_endpoint).toMatchObject({
      address: asMatcher(
        expect.stringContaining('.pravaha/dispatch/leader.sock'),
      ),
      kind: 'unix-socket',
    });
    expect(windows_endpoint).toMatchObject({
      address: asMatcher(expect.stringContaining('\\\\.\\pipe\\pravaha-')),
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
      '{"type":"notify_dispatch","source":"dispatch-cli","flow_instance_id":"flow-instance:1234"}',
    ),
  ).toEqual({
    flow_instance_id: 'flow-instance:1234',
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
  expect(parseProtocolMessage('{"type":"status_request"}')).toEqual({
    type: 'status_request',
  });
  expect(
    parseProtocolMessage(
      '{"type":"status_report","dispatcher_id":"worker-a","connected_worker_count":2,"active_assignments":[{"flow_instance_id":"flow-instance:1","worker_id":"worker-a"}]}',
    ),
  ).toEqual({
    active_assignments: [
      {
        flow_instance_id: 'flow-instance:1',
        worker_id: 'worker-a',
      },
    ],
    connected_worker_count: 2,
    dispatcher_id: 'worker-a',
    type: 'status_report',
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
      '{"type":"dispatch_assignment","assignment_id":"run-1","flow_instance_id":"flow-1","source":"queue-sync"}',
    ),
  ).toEqual({
    assignment_id: 'run-1',
    flow_instance_id: 'flow-1',
    source: 'queue-sync',
    type: 'dispatch_assignment',
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
  /** @type {ProtocolConnection | null} */
  let server_connection = null;
  /** @type {LocalDispatchMessage[]} */
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
    if (server_connection === null) {
      throw new Error('Expected a server-side protocol connection.');
    }

    sendProtocolMessage(server_connection, {
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
    sendProtocolMessage(server_connection, {
      source: 'dispatch-cli',
      type: 'notify_dispatch',
    });

    await waitForCondition(() => handled_messages.length === 1);

    const pending_message = client_connection.nextMessage();

    closeProtocolConnection(server_connection);

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
      {
        close() {},
        destroy() {},
        nextMessage() {
          return Promise.reject(new Error('boom'));
        },
        send() {},
        setMessageHandler() {},
        wait_until_closed() {
          return Promise.resolve();
        },
      },
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

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}

/**
 * @param {ProtocolConnection} protocol_connection
 * @param {LocalDispatchMessage} message
 * @returns {void}
 */
function sendProtocolMessage(protocol_connection, message) {
  protocol_connection.send(message);
}

/**
 * @param {ProtocolConnection} protocol_connection
 * @returns {void}
 */
function closeProtocolConnection(protocol_connection) {
  protocol_connection.close();
  protocol_connection.destroy();
}
