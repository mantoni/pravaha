/** @import * as $k$$l$protocol$k$js from './protocol.js'; */
import { afterEach, expect, it, vi } from 'vitest';

const {
  createWorkerSignalContextMock,
  openProtocolConnectionMock,
  startWorkerSessionMock,
  waitForMessageMock,
} = vi.hoisted(() => ({
  createWorkerSignalContextMock: vi.fn(),
  openProtocolConnectionMock: vi.fn(),
  startWorkerSessionMock: vi.fn(),
  waitForMessageMock: vi.fn(),
}));

vi.mock(import('./context.js'), () => ({
  createWorkerSignalContext: createWorkerSignalContextMock,
}));

vi.mock(import('./protocol.js'), () => ({
  openProtocolConnection: openProtocolConnectionMock,
  waitForMessage: waitForMessageMock,
}));

vi.mock(import('./worker-session.js'), () => ({
  startWorkerSession: startWorkerSessionMock,
}));

afterEach(() => {
  vi.resetModules();
  createWorkerSignalContextMock.mockReset();
  openProtocolConnectionMock.mockReset();
  startWorkerSessionMock.mockReset();
  waitForMessageMock.mockReset();
});

it('returns a failure outcome when the dispatcher reports assignment failure', async () => {
  const protocol_connection = createProtocolConnectionDouble();
  const runtime_controls = mockExplicitAssignmentRuntime({
    protocol_connection,
    response_message: {
      assignment_id: 'assignment-1',
      error: 'validation failed',
      type: 'assignment_failed',
      worker_id: 'worker-follower',
    },
  });

  const { dispatchAssignmentAndWait } =
    await import('./explicit-assignment.js');

  await expect(
    dispatchAssignmentAndWait('/repo', createAssignment()),
  ).resolves.toEqual({
    dispatcher_id: 'worker-dispatcher',
    endpoint: '/tmp/dispatch.sock',
    outcome: 'failure',
    worker_error: 'validation failed',
    worker_id: 'worker-follower',
  });
  expect(runtime_controls.stop).toHaveBeenCalledTimes(1);
  expect(runtime_controls.waitUntilStopped).toHaveBeenCalledTimes(1);
  expect(runtime_controls.cleanup).toHaveBeenCalledTimes(1);
});

it('rejects unexpected dispatcher result messages while cleaning up the worker session', async () => {
  const protocol_connection = createProtocolConnectionDouble();
  const runtime_controls = mockExplicitAssignmentRuntime({
    protocol_connection,
    response_message: {
      dispatcher_id: 'worker-dispatcher',
      type: 'dispatch_notified',
    },
  });

  const { dispatchAssignmentAndWait } =
    await import('./explicit-assignment.js');

  await expect(
    dispatchAssignmentAndWait('/repo', createAssignment()),
  ).rejects.toThrow(
    'Expected assignment_completed or assignment_failed, received dispatch_notified.',
  );
  expect(runtime_controls.stop).toHaveBeenCalledTimes(1);
  expect(runtime_controls.waitUntilStopped).toHaveBeenCalledTimes(1);
  expect(runtime_controls.cleanup).toHaveBeenCalledTimes(1);
});

it('rejects when no dispatcher accepts the explicit assignment connection', async () => {
  const runtime_controls = mockExplicitAssignmentRuntime({
    protocol_connection: null,
    response_message: null,
  });

  const { dispatchAssignmentAndWait } =
    await import('./explicit-assignment.js');

  await expect(
    dispatchAssignmentAndWait('/repo', createAssignment()),
  ).rejects.toThrow(
    'Expected a live dispatcher to accept explicit assignment execution.',
  );
  expect(runtime_controls.stop).toHaveBeenCalledTimes(1);
  expect(runtime_controls.waitUntilStopped).toHaveBeenCalledTimes(0);
  expect(runtime_controls.cleanup).toHaveBeenCalledTimes(1);
});

/**
 * @returns {Extract<$k$$l$protocol$k$js.LocalDispatchMessage, {type: 'assignment'}>}
 *   import('./protocol.js').LocalDispatchMessage,
 *   { type: 'assignment' }
 * >}
 */
function createAssignment() {
  return {
    assignment_id: 'assignment-1',
    flow_instance_id: 'flow-instance:assignment-1',
    type: 'assignment',
  };
}

/**
 * @returns {{
 *   close: ReturnType<typeof vi.fn>,
 *   destroy: ReturnType<typeof vi.fn>,
 *   nextMessage: ReturnType<typeof vi.fn>,
 *   send: ReturnType<typeof vi.fn>,
 *   setMessageHandler: ReturnType<typeof vi.fn>,
 *   wait_until_closed: ReturnType<typeof vi.fn>,
 * }}
 */
function createProtocolConnectionDouble() {
  return {
    close: vi.fn(),
    destroy: vi.fn(),
    nextMessage: vi.fn(),
    send: vi.fn(),
    setMessageHandler: vi.fn(),
    wait_until_closed: vi.fn(() => Promise.resolve()),
  };
}

/**
 * @param {{
 *   protocol_connection: ReturnType<typeof createProtocolConnectionDouble> | null,
 *   response_message: import('./protocol.js').LocalDispatchMessage | null,
 * }} options
 * @returns {{
 *   cleanup: ReturnType<typeof vi.fn>,
 *   stop: ReturnType<typeof vi.fn>,
 *   waitUntilStopped: ReturnType<typeof vi.fn>,
 * }}
 */
function mockExplicitAssignmentRuntime(options) {
  const cleanup = vi.fn(() => Promise.resolve());
  const stop = vi.fn(() => Promise.resolve());
  const waitUntilStopped = vi.fn(() => Promise.resolve());

  createWorkerSignalContextMock.mockReturnValue({
    cleanup,
    signal: undefined,
  });
  openProtocolConnectionMock.mockResolvedValue(options.protocol_connection);
  waitForMessageMock.mockImplementation(() => {
    if (options.response_message === null) {
      throw new Error('Did not expect waitForMessage without a dispatcher.');
    }

    return Promise.resolve(options.response_message);
  });
  startWorkerSessionMock.mockResolvedValue({
    dispatcher_id: 'worker-dispatcher',
    endpoint: '/tmp/dispatch.sock',
    role: 'dispatcher',
    stop,
    wait_until_stopped: waitUntilStopped,
    worker_id: 'worker-dispatcher',
  });

  return {
    cleanup,
    stop,
    waitUntilStopped,
  };
}
