/** @import { Socket } from 'node:net' */
import { EventEmitter } from 'node:events';

import { expect, it, vi } from 'vitest';

import {
  createProtocolConnection,
  parseProtocolMessage,
  reportOperatorError,
} from './protocol.js';

it('reports string protocol errors and rejects malformed assignment payloads', () => {
  const io_context = createIoContext();

  reportOperatorError(io_context, 'protocol string failure');
  expect(io_context.stderr_text()).toBe('protocol string failure\n');

  expect(() =>
    parseProtocolMessage(
      '{"type":"assignment_completed","assignment_id":"run-1"}',
    ),
  ).toThrow(
    'Expected assignment_completed to include assignment_id and worker_id.',
  );
  expect(() =>
    parseProtocolMessage(
      '{"type":"assignment_failed","assignment_id":"run-1","worker_id":"worker-a"}',
    ),
  ).toThrow(
    'Expected assignment_failed to include assignment_id, error, and worker_id.',
  );
  expect(() => parseProtocolMessage('{"type":"notify_dispatch"}')).toThrow(
    'Expected notify_dispatch to include source.',
  );
  expect(() => parseProtocolMessage('{"type":"dispatch_notified"}')).toThrow(
    'Expected dispatch_notified to include dispatcher_id.',
  );
  expect(() =>
    parseProtocolMessage(
      '{"type":"assignment_pending_approval","assignment_id":"run-1"}',
    ),
  ).toThrow(
    'Expected assignment_pending_approval to include assignment_id and worker_id.',
  );
});

it('destroys protocol connections for queued handler failures and non-Error destroys', async () => {
  const socket = createMockSocket();
  const protocol_connection = createProtocolConnection(
    /** @type {Socket} */ (/** @type {unknown} */ (socket)),
  );

  protocol_connection.setMessageHandler(() => Promise.reject('handler boom'));
  socket.emitData('{"source":"dispatch-cli","type":"notify_dispatch"}\n');
  await waitForMicrotask();

  const destroy_calls = /** @type {Array<[unknown?]>} */ (
    /** @type {unknown} */ (socket.destroy.mock.calls)
  );
  const destroy_error = destroy_calls[0]?.[0];

  expect(destroy_error).toBeInstanceOf(Error);
  expect(
    /** @type {Error} */ (/** @type {unknown} */ (destroy_error)).message,
  ).toBe('handler boom');

  protocol_connection.destroy('ignored');
  expect(socket.destroy).toHaveBeenCalledTimes(2);
  expect(socket.destroy.mock.calls[1]).toEqual([]);
});

it('rejects pending protocol reads when the socket closes before a message arrives', async () => {
  const socket = createMockSocket();
  const protocol_connection = createProtocolConnection(
    /** @type {Socket} */ (/** @type {unknown} */ (socket)),
  );
  const next_message = protocol_connection.nextMessage();

  socket.end();

  await expect(next_message).rejects.toThrow(
    'The local dispatch connection closed before a message arrived.',
  );
});

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stderr_text: () => string,
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
  };
}

function createMockSocket() {
  const emitter = new EventEmitter();

  return {
    destroy: vi.fn(() => {
      emitter.emit('close');
    }),
    /**
     * @param {string} chunk
     */
    emitData(chunk) {
      emitter.emit('data', chunk);
    },
    end: vi.fn(() => {
      emitter.emit('end');
      emitter.emit('close');
    }),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    setEncoding: vi.fn(),
    write: vi.fn(),
  };
}

/**
 * @returns {Promise<void>}
 */
async function waitForMicrotask() {
  await Promise.resolve();
}
