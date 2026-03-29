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
    execute_assigned_flow_instance: async () => ({
      outcome: 'failure',
      worker_error: 'run failed',
    }),
    flow_instance_id: 'flow-1',
  });
  await expectDispatcherFailure({
    assignment_id: 'assignment-2',
    error: 'crash',
    execute_assigned_flow_instance: async () => {
      throw new Error('crash');
    },
    flow_instance_id: 'flow-2',
  });
});

function createSharedContext() {
  return {
    async emit_event() {},
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
    materializePendingAssignments: vi.fn(async () => [
      {
        assignment_id: options.assignment_id,
        flow_instance_id: options.flow_instance_id,
        type: 'assignment',
      },
    ]),
  }));
  vi.doMock('./follower-message.js', () => ({
    handleDispatcherFollowerMessage: vi.fn(async (message) => {
      handled_messages.push(message);
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
