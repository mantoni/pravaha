/**
 * @import { LocalDispatchMessage } from './protocol.js';
 * @import { Server } from 'node:net';
 */
/* eslint-disable max-lines, max-lines-per-function */
// @module-tag lint-staged-excluded

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadProjectGraph, queryGraph } from 'patram';
import { expect, it } from 'vitest';

import {
  closeServer,
  createProtocolConnection,
  openProtocolConnection,
  removeStaleUnixSocket,
  resolveDispatchEndpoint,
  waitForMessage,
} from './protocol.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  createTaskFixture,
  FLOW_PATH,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createSuccessRunResult } from '../../../test/support/runtime.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { listUnresolvedRuntimeRecords } from '../records/runtime-records.js';
import { materializePendingAssignments } from './assignments.js';
import { handleFollowerMessage } from './dispatcher.js';
import {
  createWorkerSignalContext,
  isTransientFollowerRegistrationError,
  waitForRetryInterval,
} from './context.js';
import { handleDispatcherFollowerMessage } from './follower-message.js';
import { dispatch, dispatchAssignmentAndWait, worker } from './session.js';
import { tryListen } from './listen.js';
import { startWorkerSession } from './worker-session.js';

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
    await cleanupTempDirectory(temp_directory);
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

it('promotes a surviving follower after dispatcher shutdown', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const dispatcher_io_context = createIoContext();
  const follower_io_context = createIoContext();
  const dispatcher_session = await startWorkerSession(temp_directory, {
    operator_io: dispatcher_io_context,
    worker_id: 'worker-dispatcher',
  });
  const follower_session = await startWorkerSession(temp_directory, {
    operator_io: follower_io_context,
    worker_id: 'worker-follower',
  });

  try {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();

    await waitForCondition(
      () =>
        follower_session.role === 'dispatcher' &&
        follower_session.dispatcher_id === 'worker-follower',
    );

    await expect(dispatch(temp_directory)).resolves.toMatchObject({
      dispatcher_available: true,
      dispatcher_id: 'worker-follower',
      notification_delivered: true,
      outcome: 'success',
    });
    expect(follower_io_context.stdout_text()).toContain(
      'dispatcher connection closed; re-entering election',
    );
    expect(follower_io_context.stdout_text()).toContain(
      '[worker worker-follower dispatcher] leadership acquired',
    );
  } finally {
    await follower_session.stop();
    await follower_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('stops follower and dispatcher sessions idempotently across failover', async () => {
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

it('stops a follower cleanly while re-entering election after dispatcher loss', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-dispatch-'));
  const dispatcher_session = await startWorkerSession(temp_directory, {
    worker_id: 'worker-dispatcher',
  });
  const follower_session = await startWorkerSession(temp_directory, {
    worker_id: 'worker-follower',
  });

  try {
    await dispatcher_session.stop();
    await follower_session.stop();
    await dispatcher_session.wait_until_stopped();
    await follower_session.wait_until_stopped();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('dispatches an explicit assignment and waits for terminal success', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });

  try {
    await expect(
      dispatchAssignmentAndWait(temp_directory, {
        assignment_id: 'assignment-javascript-flow',
        binding_targets: {
          doc: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        decision_paths: [],
        flow_instance_id: 'flow-instance:explicit-assignment',
        flow_path: FLOW_PATH,
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        type: 'assignment',
        workspace: {
          id: 'app',
          location: {
            path: join(
              temp_directory,
              '.pravaha/worktrees/explicit-assignment',
            ),
          },
          mode: 'ephemeral',
          ref: 'main',
          source: {
            kind: 'repo',
          },
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'success',
    });
  } finally {
    await cleanupTempDirectory(temp_directory);
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

it('schedules and executes a pending flow instance on the dispatcher worker', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_completed' &&
        event.worker_id === 'worker-dispatcher',
    );
    expect(io_context.stdout_text()).toContain('leadership acquired');
    expect(io_context.stdout_text()).toContain('dispatching ');
    expect(io_context.stdout_text()).toContain('to worker-dispatcher');
    expect(io_context.stdout_text()).toContain('assignment completed ');
    await waitForCondition(() =>
      io_context.stdout_text().includes('still matches after terminal outcome'),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('records terminal failure for thrown assignment errors without redispatching endlessly', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createInvalidHandoffDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const [initial_assignment] = await materializePendingAssignments(
    createAssignmentMaterializationContext(temp_directory),
  );

  if (
    initial_assignment === undefined ||
    typeof initial_assignment.task_id !== 'string'
  ) {
    throw new Error('Expected a matching flow instance with a task id.');
  }

  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_failed' &&
        event.worker_id === 'worker-dispatcher',
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(
      dispatcher_events.filter(
        (event) => event.kind === 'assignment_dispatched',
      ).length,
    ).toBe(1);
    expect(
      dispatcher_events.filter((event) => event.kind === 'assignment_failed')
        .length,
    ).toBe(1);
    expect(io_context.stdout_text()).toContain('assignment failed ');

    await expect(
      materializePendingAssignments(
        createAssignmentMaterializationContext(temp_directory),
      ),
    ).resolves.toEqual([]);

    const failed_assignment_id = dispatcher_events.find(
      (event) => event.kind === 'assignment_failed',
    )?.assignment_id;

    if (typeof failed_assignment_id !== 'string') {
      throw new Error('Expected a failed assignment id.');
    }

    const runtime_record_path = join(
      temp_directory,
      '.pravaha/runtime',
      `${failed_assignment_id}.json`,
    );

    await expect(readRuntimeRecordOutcome(runtime_record_path)).resolves.toBe(
      'failure',
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('warns and suppresses already-completed matching flow instances on dispatcher startup', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const [initial_assignment] = await materializePendingAssignments(
    createAssignmentMaterializationContext(temp_directory),
  );

  if (initial_assignment === undefined) {
    throw new Error('Expected a matching flow instance.');
  }

  if (
    typeof initial_assignment.task_id !== 'string' ||
    typeof initial_assignment.task_path !== 'string'
  ) {
    throw new Error(
      'Expected the matching flow instance to include task identity.',
    );
  }

  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    join(temp_directory, '.pravaha/runtime/implement-runtime-slice.json'),
    createRuntimeRecord({
      binding_targets: initial_assignment.binding_targets,
      contract_path: CONTRACT_PATH,
      current_handler_name: 'main',
      flow_state: {},
      flow_path: FLOW_PATH,
      format_version: 'javascript-flow-v1',
      outcome: 'success',
      run_id: 'run:implement-runtime-slice:2026-03-29T09:00:00.000Z',
      task_id: initial_assignment.task_id,
      task_path: initial_assignment.task_path,
    }),
  );

  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stdout_text()
        .includes('already reached a terminal runtime outcome'),
    );
    expect(io_context.stdout_text()).toContain(
      `pravaha dispatch --flow ${initial_assignment.flow_instance_id}`,
    );
    expect(
      dispatcher_events.some((event) => event.kind === 'assignment_dispatched'),
    ).toBe(false);
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('reruns a completed matching flow instance when dispatch targets it explicitly', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const [initial_assignment] = await materializePendingAssignments(
    createAssignmentMaterializationContext(temp_directory),
  );

  if (initial_assignment === undefined) {
    throw new Error('Expected a matching flow instance.');
  }

  if (
    typeof initial_assignment.task_id !== 'string' ||
    typeof initial_assignment.task_path !== 'string'
  ) {
    throw new Error(
      'Expected the matching flow instance to include task identity.',
    );
  }

  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    join(temp_directory, '.pravaha/runtime/implement-runtime-slice.json'),
    createRuntimeRecord({
      binding_targets: initial_assignment.binding_targets,
      contract_path: CONTRACT_PATH,
      current_handler_name: 'main',
      flow_state: {},
      flow_path: FLOW_PATH,
      format_version: 'javascript-flow-v1',
      outcome: 'success',
      run_id: 'run:implement-runtime-slice:2026-03-29T09:00:00.000Z',
      task_id: initial_assignment.task_id,
      task_path: initial_assignment.task_path,
    }),
  );

  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stdout_text()
        .includes('already reached a terminal runtime outcome'),
    );

    await expect(
      dispatch(temp_directory, {
        flow_instance_id: initial_assignment.flow_instance_id,
      }),
    ).resolves.toMatchObject({
      dispatcher_available: true,
      dispatcher_id: 'worker-dispatcher',
      notification_delivered: true,
      outcome: 'success',
    });

    await waitForCondition(
      () =>
        dispatcher_events.filter(
          (event) =>
            event.kind === 'assignment_completed' &&
            event.assignment_id === initial_assignment.flow_instance_id,
        ).length >= 1,
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('keeps approval-gated flow instances unresolved without redispatching them', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createApprovalDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForUnresolvedRuntimeRecordCount(temp_directory, 0);
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_pending_approval' &&
        event.worker_id === 'worker-dispatcher',
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(
      dispatcher_events.filter(
        (event) => event.kind === 'assignment_dispatched',
      ).length,
    ).toBe(1);
    expect(
      dispatcher_events.filter(
        (event) => event.kind === 'assignment_pending_approval',
      ).length,
    ).toBe(1);
    expect(
      dispatcher_events.some((event) => event.kind === 'assignment_completed'),
    ).toBe(false);
    expect(io_context.stdout_text()).toContain('Approval requested.');
    expect(io_context.stdout_text()).toContain(
      'assignment waiting for approval ',
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('assigns one pending flow instance per ready worker when followers are connected', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
    task_documents: [
      createTaskFixture('implement-runtime-slice', 'ready'),
      createTaskFixture('review-runtime-slice', 'ready', {
        path: 'docs/tasks/runtime/review-runtime-slice.md',
      }),
    ],
  });
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const follower_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    worker_id: 'worker-dispatcher',
  });

  try {
    const follower_session = await startWorkerSession(temp_directory, {
      on_event(event) {
        follower_events.push(event);
      },
      worker_id: 'worker-follower',
    });

    try {
      await waitForEvent(
        follower_events,
        (event) =>
          event.kind === 'assignment_received' &&
          event.worker_id === 'worker-follower',
      );
      await waitForEvent(
        dispatcher_events,
        (event) =>
          event.kind === 'assignment_completed' &&
          event.worker_id === 'worker-follower',
      );
      await waitForCondition(
        () =>
          dispatcher_events.filter(
            (event) => event.kind === 'assignment_completed',
          ).length === 2,
      );
    } finally {
      await follower_session.stop();
      await follower_session.wait_until_stopped();
    }
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('rescans unresolved runtime state and resumes persisted flow instances after takeover', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];

  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    runtime_record_path,
    createRuntimeRecord({
      binding_targets: {
        doc: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      current_handler_name: 'main',
      flow_state: {},
      flow_path: FLOW_PATH,
      format_version: 'javascript-flow-v1',
      outcome: null,
      run_id: 'run:implement-runtime-slice:2026-03-27T09:00:00.000Z',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      worktree_identity: join(
        temp_directory,
        '.pravaha/worktrees/implement-runtime-slice-resume',
      ),
      worktree_mode: 'ephemeral',
      worktree_path: join(
        temp_directory,
        '.pravaha/worktrees/implement-runtime-slice-resume',
      ),
    }),
  );

  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_completed' &&
        event.worker_id === 'worker-dispatcher',
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('reports malformed resumed runtime records when flow instance bindings are ambiguous', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const io_context = createIoContext();

  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    runtime_record_path,
    createRuntimeRecord({
      binding_targets: {
        document: {
          id: 'contract:single-task-flow-reconciler',
          path: CONTRACT_PATH,
          status: 'proposed',
        },
        doc: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      current_handler_name: 'main',
      flow_state: {},
      flow_path: FLOW_PATH,
      format_version: 'javascript-flow-v1',
      outcome: null,
      run_id: 'run:implement-runtime-slice:2026-03-27T09:00:00.000Z',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    }),
  );

  const dispatcher_session = await startWorkerSession(temp_directory, {
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stderr_text()
        .includes('Expected exactly one flow instance owner binding, found 2.'),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
  }
});

it('requeues follower assignments when a registered follower disconnects mid-run', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
    task_documents: [
      createTaskFixture('implement-runtime-slice', 'ready'),
      createTaskFixture('review-runtime-slice', 'ready', {
        path: 'docs/tasks/runtime/review-runtime-slice.md',
      }),
    ],
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
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

    await expect(
      waitForMessage(follower_connection, 'Expected follower assignment.'),
    ).resolves.toMatchObject({
      type: 'assignment',
    });

    follower_connection.close();
    follower_connection.destroy();
    await follower_connection.wait_until_closed();

    await waitForCondition(
      () =>
        dispatcher_events.filter(
          (event) =>
            event.kind === 'assignment_completed' &&
            event.worker_id === 'worker-dispatcher',
        ).length === 2,
    );
    expect(io_context.stdout_text()).toContain(
      'follower disconnected: worker-external',
    );
    expect(io_context.stdout_text()).toContain('released 1 assignment');
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await cleanupTempDirectory(temp_directory);
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
  /** @type {ProtocolConnection | null} */
  let follower_connection = null;
  /** @type {Array<Record<string, unknown>>} */
  const follower_events = [];
  /** @type {unknown} */
  let server_error = null;

  try {
    fake_dispatcher.on('connection', (socket) => {
      const active_follower_connection = createProtocolConnection(socket);
      follower_connection = active_follower_connection;

      void (async () => {
        try {
          const registration_message = await waitForMessage(
            active_follower_connection,
            'Expected follower registration request.',
          );

          expect(registration_message).toEqual({
            type: 'register_worker',
            worker_id: 'worker-follower',
          });

          active_follower_connection.send({
            dispatcher_id: 'worker-dispatcher',
            type: 'worker_registered',
          });
          active_follower_connection.send({
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
      if (follower_connection !== null) {
        await closeProtocolConnection(follower_connection);
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
    emit_event(event) {
      emitted_events.push(event);

      return Promise.resolve();
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
      type: 'assignment_pending_approval',
      worker_id: 'worker-helper',
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
        kind: 'assignment_pending_approval',
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

it('classifies transient follower registration failures and waits before retry', async () => {
  expect(isTransientFollowerRegistrationError('not-an-error')).toBe(false);
  expect(
    isTransientFollowerRegistrationError(
      new Error('Expected a live dispatcher to accept follower registration.'),
    ),
  ).toBe(true);
  expect(
    isTransientFollowerRegistrationError(
      new Error('Expected the dispatcher to acknowledge worker registration.'),
    ),
  ).toBe(true);
  expect(
    isTransientFollowerRegistrationError(new Error('Unexpected failure.')),
  ).toBe(false);

  await expect(waitForRetryInterval()).resolves.toBeUndefined();
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
    'dispatcher.sock',
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
        .includes(
          'Expected register_worker, notify_dispatch, status_request, or dispatch_assignment',
        ),
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

it('reports malformed trigger candidates when scheduler-visible graph data omits status', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  const dispatcher_session = await startWorkerSession(temp_directory, {
    graph_api: {
      load_project_graph: loadProjectGraph,
      query_graph(graph, query_text, config, bindings) {
        const query_result = queryGraph(
          /** @type {any} */ (graph),
          query_text,
          /** @type {any} */ (config),
          bindings,
        );

        for (const task_node of query_result.nodes) {
          if (task_node.$id === 'task:implement-runtime-slice') {
            delete task_node.status;
          }
        }

        return query_result;
      },
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stderr_text()
        .includes('Expected trigger document to expose a status.'),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports malformed trigger candidates when scheduler-visible graph data omits id', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  const dispatcher_session = await startWorkerSession(temp_directory, {
    graph_api: {
      load_project_graph: loadProjectGraph,
      query_graph(graph, query_text, config, bindings) {
        const query_result = queryGraph(
          /** @type {any} */ (graph),
          query_text,
          /** @type {any} */ (config),
          bindings,
        );

        for (const task_node of query_result.nodes) {
          if (task_node.$id === 'task:implement-runtime-slice') {
            delete task_node.$id;
          }
        }

        return query_result;
      },
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stderr_text()
        .includes('Expected trigger document to expose a Patram id.'),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports malformed trigger candidates when scheduler-visible graph data omits path', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  const io_context = createIoContext();
  const dispatcher_session = await startWorkerSession(temp_directory, {
    graph_api: {
      load_project_graph: loadProjectGraph,
      query_graph(graph, query_text, config, bindings) {
        const query_result = queryGraph(
          /** @type {any} */ (graph),
          query_text,
          /** @type {any} */ (config),
          bindings,
        );

        for (const task_node of query_result.nodes) {
          if (task_node.$id === 'task:implement-runtime-slice') {
            delete task_node.$path;
          }
        }

        return query_result;
      },
    },
    operator_io: io_context,
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForCondition(() =>
      io_context
        .stderr_text()
        .includes('Expected trigger document to expose a path.'),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports assignment execution failures to followers and normalizes non-Error causes', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    emit_event(event) {
      emitted_events.push(event);

      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    graph_api: {
      load_project_graph() {
        return createStringRejectedPromise('plain failure');
      },
      query_graph: /** @type {any} */ (queryGraph),
    },
    log_to_operator() {},
    now() {
      return new Date('2026-03-27T10:00:00.000Z');
    },
    operator_io: createIoContext(),
    repo_directory: temp_directory,
    signal: undefined,
    worker_id: 'worker-helper',
  };

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createRuntimeRecord({
        binding_targets: {
          document: {
            id: 'contract:single-task-flow-reconciler',
            path: CONTRACT_PATH,
            status: 'proposed',
          },
          doc: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        current_handler_name: 'main',
        flow_state: {},
        flow_path: FLOW_PATH,
        format_version: 'javascript-flow-v1',
        outcome: null,
        run_id: 'run:implement-runtime-slice:2026-03-27T10:00:00.000Z',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      }),
    );

    await handleFollowerMessage(
      {
        assignment_id: 'assignment-plain-failure',
        flow_instance_id: 'flow-instance:plain-failure',
        resume_runtime_record_path: runtime_record_path,
        type: 'assignment',
      },
      shared_context,
      createMessageSink(sent_messages),
    );

    expect(emitted_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignment_id: 'assignment-plain-failure',
          kind: 'assignment_received',
        }),
      ]),
    );
    expect(sent_messages).toEqual([
      {
        assignment_id: 'assignment-plain-failure',
        error: 'plain failure',
        type: 'assignment_failed',
        worker_id: 'worker-helper',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports missing assignment execution context to followers', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    emit_event(event) {
      emitted_events.push(event);

      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    log_to_operator() {},
    operator_io: createIoContext(),
    signal: undefined,
    worker_id: 'worker-helper',
  };

  await handleFollowerMessage(
    {
      assignment_id: 'assignment-missing-context',
      flow_instance_id: 'flow-instance:missing-context',
      type: 'assignment',
    },
    shared_context,
    createMessageSink(sent_messages),
  );

  expect(emitted_events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        assignment_id: 'assignment-missing-context',
        kind: 'assignment_received',
      }),
    ]),
  );
  expect(sent_messages).toEqual([
    {
      assignment_id: 'assignment-missing-context',
      error: 'Expected assignment execution context to be fully bound.',
      type: 'assignment_failed',
      worker_id: 'worker-helper',
    },
  ]);
});

it('executes a JavaScript flow assignment payload on the follower path', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_module_source: createDispatchFlowModuleSource(),
  });
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    emit_event(event) {
      emitted_events.push(event);

      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    graph_api: {
      async load_project_graph() {
        return await loadProjectGraph(temp_directory);
      },
      query_graph: /** @type {any} */ (queryGraph),
    },
    log_to_operator() {},
    now() {
      return new Date('2026-03-27T10:00:00.000Z');
    },
    operator_io: createIoContext(),
    repo_directory: temp_directory,
    signal: undefined,
    worker_client: {
      startThread() {
        return {
          id: 'thread-javascript-flow',
          run() {
            return Promise.resolve(createSuccessRunResult());
          },
        };
      },
    },
    worker_id: 'worker-helper',
  };

  await handleFollowerMessage(
    {
      assignment_id: 'assignment-javascript-flow',
      binding_targets: {
        doc: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      decision_paths: [],
      flow_instance_id: 'flow-instance:javascript-flow',
      flow_path: FLOW_PATH,
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      type: 'assignment',
      workspace: {
        id: 'app',
        location: {
          path: join(temp_directory, '.pravaha/worktrees/worker-helper'),
        },
        mode: 'ephemeral',
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
    shared_context,
    /** @type {any} */ ({
      /** @param {Record<string, unknown>} message */
      send(message) {
        sent_messages.push(message);
      },
    }),
  );

  expect(emitted_events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        assignment_id: 'assignment-javascript-flow',
        kind: 'assignment_received',
      }),
    ]),
  );
  expect(sent_messages).toEqual([
    {
      assignment_id: 'assignment-javascript-flow',
      type: 'assignment_completed',
      worker_id: 'worker-helper',
    },
  ]);
});

/**
 * @param {Server} server
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
 * @param {Array<Record<string, unknown>>} sent_messages
 * @returns {ProtocolConnection}
 */
function createMessageSink(sent_messages) {
  return {
    close() {},
    destroy() {},
    nextMessage() {
      return Promise.reject(
        new Error('Did not expect nextMessage in this test.'),
      );
    },
    /** @param {import('./protocol.js').LocalDispatchMessage} message */
    send(message) {
      sent_messages.push(message);
    },
    setMessageHandler() {},
    wait_until_closed() {
      return Promise.resolve();
    },
  };
}

/**
 * @param {string} message
 * @returns {Promise<never>}
 */
function createStringRejectedPromise(message) {
  return /** @type {Promise<never>} */ ({
    then(_resolve, reject) {
      reject?.(message);

      return Promise.resolve();
    },
  });
}

/**
 * @param {ProtocolConnection} protocol_connection
 * @returns {Promise<void>}
 */
async function closeProtocolConnection(protocol_connection) {
  protocol_connection.close();
  protocol_connection.destroy();
  await protocol_connection.wait_until_closed();
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
  for (let index = 0; index < 300; index += 1) {
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
 * @param {string} repo_directory
 * @param {number} expected_count
 * @returns {Promise<void>}
 */
async function waitForUnresolvedRuntimeRecordCount(
  repo_directory,
  expected_count,
) {
  for (let index = 0; index < 100; index += 1) {
    let unresolved_runtime_records;

    try {
      unresolved_runtime_records =
        await listUnresolvedRuntimeRecords(repo_directory);
    } catch (error) {
      if (
        error instanceof SyntaxError &&
        error.message.includes('JSON input')
      ) {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        continue;
      }

      throw error;
    }

    if (unresolved_runtime_records.length === expected_count) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out while waiting for unresolved runtime records.');
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function cleanupTempDirectory(temp_directory) {
  try {
    await rm(temp_directory, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 20,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOTEMPTY'
    ) {
      return;
    }

    throw error;
  }
}

/**
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecordFixture(runtime_record_path, runtime_record) {
  await mkdir(dirname(runtime_record_path), { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}

/**
 * @param {string} temp_directory
 * @returns {{
 *   emit_event: () => Promise<void>,
 *   endpoint: string,
 *   graph_api: any,
 *   log_to_operator: () => void,
 *   now: () => Date,
 *   repo_directory: string,
 *   worker_id: string,
 * }}
 */
function createAssignmentMaterializationContext(temp_directory) {
  return {
    emit_event() {
      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    graph_api: /** @type {any} */ ({
      load_project_graph: loadProjectGraph,
      query_graph: queryGraph,
    }),
    log_to_operator() {},
    now() {
      return new Date();
    },
    repo_directory: temp_directory,
    worker_id: 'worker-dispatcher',
  };
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

/**
 * @returns {string}
 */
function createDispatchFlowModuleSource() {
  return [
    "import { defineFlow, run } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await run(ctx, { command: 'true' });",
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createInvalidHandoffDispatchFlowModuleSource() {
  return [
    "import { defineFlow, worktreeHandoff } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    '    await worktreeHandoff(ctx, {',
    "      branch: 'review/ready/${{ doc.id }}',",
    '    });',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createApprovalDispatchFlowModuleSource() {
  return [
    "import { approve, defineFlow, run } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await run(ctx, { command: 'true' });",
    '    await approve(ctx, {',
    "      title: `Review ${ctx.bindings.doc?.path ?? 'unknown'}` ,",
    "      message: 'Approve the dispatched implementation.',",
    '    });',
    '  },',
    '  async onApprove(ctx) {',
    '    void ctx;',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {string} runtime_record_path
 * @returns {Promise<string>}
 */
async function readRuntimeRecordOutcome(runtime_record_path) {
  const parsed_value = /** @type {unknown} */ (
    JSON.parse(await readFile(runtime_record_path, 'utf8'))
  );

  if (!isRecord(parsed_value)) {
    throw new Error(
      `Expected ${runtime_record_path} to contain a JSON object runtime record.`,
    );
  }

  const local_outcome = parsed_value.local_outcome;

  if (!isRecord(local_outcome) || typeof local_outcome.state !== 'string') {
    throw new Error(
      `Expected ${runtime_record_path} to include a local outcome state.`,
    );
  }

  return local_outcome.state;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
