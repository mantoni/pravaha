/* eslint-disable max-lines, max-lines-per-function */
// @module-tag lint-staged-excluded

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  closeServer,
  createProtocolConnection,
  openProtocolConnection,
  removeStaleUnixSocket,
  resolveDispatchEndpoint,
  waitForMessage,
} from './local-dispatch-protocol.js';
import {
  createWorkerSignalContext,
  dispatch,
  handleDispatcherFollowerMessage,
  handleFollowerMessage,
  startWorkerSession,
  tryListen,
  worker,
} from './local-dispatch-runtime.js';

it('elects one dispatcher, registers a follower, and delivers a manual notify', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const dispatcher_io_context = createIoContext();
  const follower_io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: dispatcher_io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    const follower_session = await startWorkerSession(temp_directory, {
      operator_io: follower_io_context,
      worker_id: 'worker-follower',
    });

    try {
      expect(dispatcher_session).toMatchObject({
        dispatcher_id: 'worker-dispatcher',
        role: 'dispatcher',
        worker_id: 'worker-dispatcher',
      });
      expect(follower_session).toMatchObject({
        dispatcher_id: 'worker-dispatcher',
        role: 'follower',
        worker_id: 'worker-follower',
      });

      await waitForEvent(
        dispatcher_events,
        (event) =>
          event.kind === 'follower_registered' &&
          event.worker_id === 'worker-follower',
      );

      await expect(dispatch(temp_directory)).resolves.toMatchObject({
        dispatcher_available: true,
        dispatcher_id: 'worker-dispatcher',
        notification_delivered: true,
        outcome: 'success',
      });

      await waitForEvent(
        dispatcher_events,
        (event) =>
          event.kind === 'dispatch_notified' && event.source === 'dispatch-cli',
      );

      expect(dispatcher_io_context.stdout_text()).toContain(
        '[worker worker-dispatcher dispatcher]',
      );
      expect(follower_io_context.stdout_text()).toContain(
        '[worker worker-follower follower]',
      );
    } finally {
      await follower_session.stop();
      await follower_session.wait_until_stopped();
    }
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('allows a later worker to acquire dispatcher leadership after shutdown', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const first_session = await startWorkerSession(temp_directory, {
    worker_id: 'worker-first',
  });

  try {
    expect(first_session.role).toBe('dispatcher');
  } finally {
    await first_session.stop();
    await first_session.wait_until_stopped();
  }

  try {
    const second_session = await startWorkerSession(temp_directory, {
      worker_id: 'worker-second',
    });

    try {
      expect(second_session).toMatchObject({
        dispatcher_id: 'worker-second',
        role: 'dispatcher',
        worker_id: 'worker-second',
      });
    } finally {
      await second_session.stop();
      await second_session.wait_until_stopped();
    }
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('stops follower and dispatcher sessions idempotently and disconnects attached followers', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const dispatcher_session = await startWorkerSession(temp_directory, {
    worker_id: 'worker-dispatcher',
  });
  const follower_session = await startWorkerSession(temp_directory, {
    worker_id: 'worker-follower',
  });

  try {
    await dispatcher_session.stop();
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();

    await follower_session.stop();
    await follower_session.stop();
    await follower_session.wait_until_stopped();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports best-effort success when no dispatcher is available', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));

  try {
    await expect(dispatch(temp_directory)).resolves.toMatchObject({
      dispatcher_available: false,
      dispatcher_id: null,
      notification_delivered: false,
      outcome: 'success',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('runs the worker entrypoint until abort and reports the stopped dispatcher summary', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const abort_controller = new AbortController();

  try {
    const worker_result_promise = worker(temp_directory, {
      signal: abort_controller.signal,
      worker_id: 'worker-abort',
    });

    setTimeout(() => {
      abort_controller.abort();
    }, 20);

    await expect(worker_result_promise).resolves.toMatchObject({
      dispatcher_id: 'worker-abort',
      outcome: 'stopped',
      role: 'dispatcher',
      worker_id: 'worker-abort',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('generates a worker id when none is provided and stops through the explicit session handle', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const abort_controller = new AbortController();

  try {
    const worker_session = await startWorkerSession(temp_directory, {
      signal: abort_controller.signal,
    });

    expect(worker_session.worker_id).toMatch(/^worker-/);

    abort_controller.abort();
    await worker_session.wait_until_stopped();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('records completion and failure events from a registered follower connection', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    worker_id: 'worker-dispatcher',
  });
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const follower_connection = await openProtocolConnection(endpoint.address);

  if (follower_connection === null) {
    throw new Error('Expected the dispatcher to accept follower registration.');
  }

  try {
    follower_connection.send({
      type: 'register_worker',
      worker_id: 'worker-external',
    });

    await expect(
      waitForMessage(
        follower_connection,
        'Expected dispatcher registration acknowledgement.',
      ),
    ).resolves.toEqual({
      dispatcher_id: 'worker-dispatcher',
      type: 'worker_registered',
    });

    follower_connection.send({
      assignment_id: 'run-complete',
      type: 'assignment_completed',
      worker_id: 'worker-external',
    });
    follower_connection.send({
      assignment_id: 'run-failed',
      error: 'boom',
      type: 'assignment_failed',
      worker_id: 'worker-external',
    });

    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_completed' &&
        event.assignment_id === 'run-complete',
    );
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_failed' &&
        event.assignment_id === 'run-failed',
    );
  } finally {
    follower_connection.close();
    follower_connection.destroy();
    await follower_connection.wait_until_closed();
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects assignment messages onto follower worker events', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const fake_dispatcher = createServer();
  /** @type {any} */
  let follower_connection = null;
  /** @type {Array<Record<string, unknown>>} */
  const follower_events = [];
  /** @type {unknown} */
  let server_error = null;

  try {
    fake_dispatcher.on('connection', (socket) => {
      follower_connection = createProtocolConnection(socket);

      void (async () => {
        try {
          const registration_message = await waitForMessage(
            follower_connection,
            'Expected follower registration request.',
          );

          expect(registration_message).toEqual({
            type: 'register_worker',
            worker_id: 'worker-follower',
          });

          follower_connection.send({
            dispatcher_id: 'worker-dispatcher',
            type: 'worker_registered',
          });
          follower_connection.send({
            assignment_id: 'flow-run-1',
            flow_instance_id: 'flow:demo',
            type: 'assignment',
          });
        } catch (error) {
          if (isProbeDisconnect(error)) {
            return;
          }

          server_error = error;
        }
      })();
    });
    await listen(fake_dispatcher, endpoint.address);

    const follower_session = await startWorkerSession(temp_directory, {
      on_event(event) {
        follower_events.push(event);
      },
      worker_id: 'worker-follower',
    });

    try {
      await waitForCondition(() => follower_connection !== null);

      await waitForEvent(
        follower_events,
        (event) =>
          event.kind === 'assignment_received' &&
          event.assignment_id === 'flow-run-1',
      );
      expect(server_error).toBeNull();

      await follower_session.stop();
      await follower_session.wait_until_stopped();
    } finally {
      if (follower_connection) {
        follower_connection.close();
        follower_connection.destroy();
        await follower_connection.wait_until_closed();
      }
    }
  } finally {
    await closeServer(fake_dispatcher);
    if (endpoint.kind === 'unix-socket') {
      await removeStaleUnixSocket(endpoint.address);
    }

    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('projects helper message handlers for follower and dispatcher branches', async () => {
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    async emit_event(event) {
      emitted_events.push(event);
    },
    endpoint: '/tmp/dispatch.sock',
    /** @param {string} line */
    log_to_operator(line) {
      io_context.stdout.write(`${line}\n`);
    },
    operator_io: io_context,
    signal: undefined,
    worker_id: 'worker-helper',
  };

  await handleFollowerMessage(
    {
      assignment_id: 'assignment-1',
      flow_instance_id: 'flow:demo',
      type: 'assignment',
    },
    shared_context,
  );
  await handleDispatcherFollowerMessage(
    {
      assignment_id: 'assignment-1',
      type: 'assignment_completed',
      worker_id: 'worker-helper',
    },
    shared_context,
  );
  await handleDispatcherFollowerMessage(
    {
      assignment_id: 'assignment-2',
      error: 'boom',
      type: 'assignment_failed',
      worker_id: 'worker-helper',
    },
    shared_context,
  );

  await expect(
    handleFollowerMessage(
      {
        dispatcher_id: 'worker-dispatcher',
        type: 'dispatch_notified',
      },
      shared_context,
    ),
  ).rejects.toThrow('Unexpected follower message dispatch_notified.');
  await expect(
    handleDispatcherFollowerMessage(
      {
        dispatcher_id: 'worker-dispatcher',
        type: 'dispatch_notified',
      },
      shared_context,
    ),
  ).rejects.toThrow('Unexpected dispatcher message dispatch_notified.');

  expect(emitted_events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        assignment_id: 'assignment-1',
        kind: 'assignment_received',
      }),
      expect.objectContaining({
        assignment_id: 'assignment-1',
        kind: 'assignment_completed',
      }),
      expect.objectContaining({
        assignment_id: 'assignment-2',
        kind: 'assignment_failed',
      }),
    ]),
  );
});

it('creates and cleans up the default worker signal context on SIGINT', async () => {
  const signal_context = createWorkerSignalContext(undefined);

  try {
    process.emit('SIGINT');
    await waitForCondition(() => signal_context.signal?.aborted === true);

    expect(signal_context.signal?.aborted).toBe(true);
  } finally {
    await signal_context.cleanup();
  }
});

it('returns false when tryListen hits an occupied endpoint', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const occupied_server = createServer();
  const waiting_server = createServer();

  try {
    await listen(occupied_server, endpoint.address);

    await expect(tryListen(waiting_server, endpoint.address)).resolves.toBe(
      false,
    );
  } finally {
    await closeServer(occupied_server);
    await closeServer(waiting_server);
    if (endpoint.kind === 'unix-socket') {
      await removeStaleUnixSocket(endpoint.address);
    }

    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects unexpected listen failures from tryListen', async () => {
  const failing_server = createServer();
  const missing_directory_path = join(
    '/definitely-missing',
    'pravaha',
    'leader.sock',
  );

  await expect(
    tryListen(failing_server, missing_directory_path),
  ).rejects.toThrow();
});

it('reports invalid initial dispatcher protocol messages to operator stderr', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const io_context = createIoContext();
  const dispatcher_session = await startWorkerSession(temp_directory, {
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });
  const endpoint = await resolveDispatchEndpoint(
    temp_directory,
    process.platform,
  );
  const client_connection = await openProtocolConnection(endpoint.address);

  if (client_connection === null) {
    throw new Error('Expected the dispatcher to accept a test connection.');
  }

  try {
    client_connection.send({
      assignment_id: 'run-invalid',
      type: 'assignment_completed',
      worker_id: 'worker-invalid',
    });

    await waitForCondition(() =>
      io_context
        .stderr_text()
        .includes('Expected register_worker or notify_dispatch'),
    );
  } finally {
    client_connection.close();
    client_connection.destroy();
    await client_connection.wait_until_closed();
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
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
 *   stdout: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout_text: () => string,
 * }}
 */
function createIoContext() {
  let stdout = '';
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
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stdout_text() {
      return stdout;
    },
  };
}

/**
 * @param {Array<Record<string, unknown>>} events
 * @param {(event: Record<string, unknown>) => boolean} matcher
 * @returns {Promise<void>}
 */
async function waitForEvent(events, matcher) {
  for (let index = 0; index < 100; index += 1) {
    if (events.some((event) => matcher(event))) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out while waiting for a local dispatch event.');
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

  throw new Error('Timed out while waiting for the condition.');
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isProbeDisconnect(error) {
  return (
    error instanceof Error &&
    error.message === 'Expected follower registration request.' &&
    error.cause instanceof Error &&
    error.cause.message ===
      'The local dispatch connection closed before a message arrived.'
  );
}
