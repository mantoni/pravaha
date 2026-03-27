/**
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
} from './local-dispatch-protocol.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  createTaskFixture,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { createSuccessRunResult } from './run-happy-path.assertions-test-helpers.js';
import { createRuntimeRecord } from './runtime-record-model.js';
import {
  createWorkerSignalContext,
  dispatch,
  handleDispatcherFollowerMessage,
  handleFollowerMessage,
  isTransientFollowerRegistrationError,
  selectRunnableDispatchJob,
  startWorkerSession,
  tryListen,
  waitForRetryInterval,
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
    flow_document_text: createDispatchFlowDocumentText(),
  });
  const io_context = createIoContext();
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  let dispatcher_start_count = 0;
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    operator_io: io_context,
    worker_client: {
      startThread() {
        dispatcher_start_count += 1;

        return {
          id: 'thread-dispatcher',
          async run() {
            return createSuccessRunResult();
          },
        };
      },
    },
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForFileStatus(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'review',
    );

    expect(dispatcher_start_count).toBe(1);
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_completed' &&
        event.worker_id === 'worker-dispatcher',
    );
    expect(io_context.stdout_text()).toContain('leadership acquired');
    expect(io_context.stdout_text()).toContain('dispatching flow-instance:');
    expect(io_context.stdout_text()).toContain('to worker-dispatcher');
    expect(io_context.stdout_text()).toContain(
      'assignment completed flow-instance:',
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('assigns one pending flow instance per ready worker when followers are connected', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createDispatchFlowDocumentText(),
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
  let dispatcher_start_count = 0;
  let follower_start_count = 0;
  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    worker_client: {
      startThread() {
        dispatcher_start_count += 1;

        return {
          id: `thread-dispatcher-${dispatcher_start_count}`,
          async run() {
            await new Promise((resolve) => {
              setTimeout(resolve, 30);
            });

            return createSuccessRunResult();
          },
        };
      },
    },
    worker_id: 'worker-dispatcher',
  });

  try {
    const follower_session = await startWorkerSession(temp_directory, {
      on_event(event) {
        follower_events.push(event);
      },
      worker_client: {
        startThread() {
          follower_start_count += 1;

          return {
            id: `thread-follower-${follower_start_count}`,
            async run() {
              return createSuccessRunResult();
            },
          };
        },
      },
      worker_id: 'worker-follower',
    });

    try {
      await waitForFileStatus(
        join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
        'review',
      );
      await waitForFileStatus(
        join(temp_directory, 'docs/tasks/runtime/review-runtime-slice.md'),
        'review',
      );

      expect(dispatcher_start_count).toBe(1);
      expect(follower_start_count).toBe(1);
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

it('rescans unresolved runtime state and resumes persisted flow instances after takeover', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createDispatchFlowDocumentText(),
  });
  const worktree_path = join(
    temp_directory,
    '.pravaha/worktrees/ephemeral-implement-runtime-slice',
  );
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  /** @type {Array<Record<string, unknown>>} */
  const dispatcher_events = [];
  let resume_count = 0;

  await mkdir(worktree_path, { recursive: true });
  await mkdir(join(worktree_path, '.git'), { recursive: true });
  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    runtime_record_path,
    createRuntimeRecord({
      await_query:
        '$class == $signal and kind == worker_completed and subject == task',
      binding_targets: {
        document: {
          id: 'contract:single-task-flow-reconciler',
          path: CONTRACT_PATH,
          status: 'proposed',
        },
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      leased_at: '2026-03-27T09:00:00.000Z',
      next_step_index: 0,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'core/codex-sdk',
        },
      ],
      outcome: null,
      prompt: 'Persisted prompt.',
      run_id: 'run:implement-runtime-slice:2026-03-27T09:00:00.000Z',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_conditions: {
        failure:
          '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
        success:
          '$class == $signal and kind == worker_completed and subject == task and outcome == success',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worker_error: null,
      worker_final_response: null,
      worker_item_count: 0,
      worker_thread_id: 'thread-resume',
      worker_usage: null,
      worktree_identity: 'ephemeral-implement-runtime-slice',
      worktree_mode: 'ephemeral',
      worktree_path,
    }),
  );

  const dispatcher_session = await startWorkerSession(temp_directory, {
    on_event(event) {
      dispatcher_events.push(event);
    },
    worker_client: {
      resumeThread(thread_id) {
        expect(thread_id).toBe('thread-resume');
        resume_count += 1;

        return {
          id: null,
          async run() {
            return createSuccessRunResult();
          },
        };
      },
      startThread() {
        throw new Error('resume should not start a new thread');
      },
    },
    worker_id: 'worker-dispatcher',
  });

  try {
    await waitForFileStatus(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'review',
    );

    expect(resume_count).toBe(1);
    await waitForEvent(
      dispatcher_events,
      (event) =>
        event.kind === 'assignment_completed' &&
        event.worker_id === 'worker-dispatcher',
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports malformed resumed runtime records when flow instance bindings are missing', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createDispatchFlowDocumentText(),
  });
  const worktree_path = join(
    temp_directory,
    '.pravaha/worktrees/ephemeral-implement-runtime-slice',
  );
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const io_context = createIoContext();

  await mkdir(worktree_path, { recursive: true });
  await mkdir(join(worktree_path, '.git'), { recursive: true });
  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeRuntimeRecordFixture(
    runtime_record_path,
    createRuntimeRecord({
      await_query:
        '$class == $signal and kind == worker_completed and subject == task',
      binding_targets: {
        document: {
          id: 'contract:single-task-flow-reconciler',
          path: CONTRACT_PATH,
          status: 'proposed',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      leased_at: '2026-03-27T09:00:00.000Z',
      next_step_index: 0,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'core/codex-sdk',
        },
      ],
      outcome: null,
      prompt: 'Persisted prompt.',
      run_id: 'run:implement-runtime-slice:2026-03-27T09:00:00.000Z',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_conditions: {
        failure:
          '$class == $signal and kind == worker_completed and subject == task and outcome == failure',
        success:
          '$class == $signal and kind == worker_completed and subject == task and outcome == success',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worker_error: null,
      worker_final_response: null,
      worker_item_count: 0,
      worker_thread_id: 'thread-resume',
      worker_usage: null,
      worktree_identity: 'ephemeral-implement-runtime-slice',
      worktree_mode: 'ephemeral',
      worktree_path,
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
        .includes(
          'Expected exactly one non-document flow instance binding, found 0.',
        ),
    );
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('requeues follower assignments when a registered follower disconnects mid-run', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createDispatchFlowDocumentText(),
    task_documents: [
      createTaskFixture('implement-runtime-slice', 'ready'),
      createTaskFixture('review-runtime-slice', 'ready', {
        path: 'docs/tasks/runtime/review-runtime-slice.md',
      }),
    ],
  });
  const io_context = createIoContext();
  let dispatcher_start_count = 0;
  const dispatcher_session = await startWorkerSession(temp_directory, {
    operator_io: io_context,
    worker_client: {
      startThread() {
        dispatcher_start_count += 1;

        return {
          id: 'thread-dispatcher',
          async run() {
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });

            return createSuccessRunResult();
          },
        };
      },
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

    await expect(
      waitForMessage(follower_connection, 'Expected follower assignment.'),
    ).resolves.toMatchObject({
      type: 'assignment',
    });

    follower_connection.close();
    follower_connection.destroy();
    await follower_connection.wait_until_closed();

    await waitForFileStatus(
      join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
      'review',
    );
    await waitForFileStatus(
      join(temp_directory, 'docs/tasks/runtime/review-runtime-slice.md'),
      'review',
    );
    expect(dispatcher_start_count).toBe(2);
    expect(io_context.stdout_text()).toContain(
      'follower disconnected: worker-external',
    );
    expect(io_context.stdout_text()).toContain('released 1 assignment');
  } finally {
    await dispatcher_session.stop();
    await dispatcher_session.wait_until_stopped();
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

it('exhausts document-transition dispatch jobs before selecting runnable work', () => {
  const project_graph_result = {
    config: {},
    graph: {},
  };
  const graph_api = {
    query_graph() {
      throw new Error('Expected this test not to query the graph.');
    },
  };
  const false_query_graph_api = {
    query_graph() {
      return {
        diagnostics: [],
        nodes: [],
      };
    },
  };
  const contract_node = {
    $id: 'contract:local-dispatch-runtime',
  };
  const trigger_node = {
    $id: 'task:implement-runtime-slice',
  };

  expect(
    selectRunnableDispatchJob(
      {
        ordered_jobs: [
          {
            if_query: null,
            job_name: 'transition-first',
            kind: 'document-transition',
            needs: [],
            transition_target_binding: 'document',
            transition_target_state: 'review',
          },
          {
            await_query: '$class == $signal',
            if_query: null,
            job_name: 'run-second',
            kind: 'triggered-document',
            needs: ['transition-first'],
            ordered_steps: [],
            transition_conditions: {
              failure: '$class == $signal and outcome == failure',
              success: '$class == $signal and outcome == success',
            },
            transition_target_bindings: {
              failure: 'task',
              success: 'task',
            },
            transition_targets: {
              failure: 'blocked',
              success: 'review',
            },
            worktree_policy: {
              mode: 'ephemeral',
            },
          },
        ],
        trigger: {
          binding_name: 'task',
          query_text: '$class=task',
          role: 'document',
        },
      },
      /** @type {any} */ (project_graph_result),
      graph_api,
      /** @type {any} */ (contract_node),
      /** @type {any} */ (trigger_node),
    ),
  ).toMatchObject({
    job_name: 'run-second',
    kind: 'triggered-document',
  });
  expect(
    selectRunnableDispatchJob(
      {
        ordered_jobs: [
          {
            await_query: '$class == $signal',
            if_query: null,
            job_name: 'wait-for-missing-need',
            kind: 'triggered-document',
            needs: ['missing-job'],
            ordered_steps: [],
            transition_conditions: {
              failure: '$class == $signal and outcome == failure',
              success: '$class == $signal and outcome == success',
            },
            transition_target_bindings: {
              failure: 'task',
              success: 'task',
            },
            transition_targets: {
              failure: 'blocked',
              success: 'review',
            },
            worktree_policy: {
              mode: 'ephemeral',
            },
          },
          {
            await_query: '$class == $signal',
            if_query: null,
            job_name: 'run-after-unmet-needs',
            kind: 'triggered-document',
            needs: [],
            ordered_steps: [],
            transition_conditions: {
              failure: '$class == $signal and outcome == failure',
              success: '$class == $signal and outcome == success',
            },
            transition_target_bindings: {
              failure: 'task',
              success: 'task',
            },
            transition_targets: {
              failure: 'blocked',
              success: 'review',
            },
            worktree_policy: {
              mode: 'ephemeral',
            },
          },
        ],
        trigger: {
          binding_name: 'task',
          query_text: '$class=task',
          role: 'document',
        },
      },
      /** @type {any} */ (project_graph_result),
      graph_api,
      /** @type {any} */ (contract_node),
      /** @type {any} */ (trigger_node),
    ),
  ).toMatchObject({
    job_name: 'run-after-unmet-needs',
    kind: 'triggered-document',
  });
  expect(
    selectRunnableDispatchJob(
      {
        ordered_jobs: [
          {
            await_query: '$class == $signal',
            if_query: '$class=missing',
            job_name: 'conditionally-skipped',
            kind: 'triggered-document',
            needs: [],
            ordered_steps: [],
            transition_conditions: {
              failure: '$class == $signal and outcome == failure',
              success: '$class == $signal and outcome == success',
            },
            transition_target_bindings: {
              failure: 'task',
              success: 'task',
            },
            transition_targets: {
              failure: 'blocked',
              success: 'review',
            },
            worktree_policy: {
              mode: 'ephemeral',
            },
          },
          {
            await_query: '$class == $signal',
            if_query: null,
            job_name: 'run-after-false-condition',
            kind: 'triggered-document',
            needs: ['conditionally-skipped'],
            ordered_steps: [],
            transition_conditions: {
              failure: '$class == $signal and outcome == failure',
              success: '$class == $signal and outcome == success',
            },
            transition_target_bindings: {
              failure: 'task',
              success: 'task',
            },
            transition_targets: {
              failure: 'blocked',
              success: 'review',
            },
            worktree_policy: {
              mode: 'ephemeral',
            },
          },
        ],
        trigger: {
          binding_name: 'task',
          query_text: '$class=task',
          role: 'document',
        },
      },
      /** @type {any} */ (project_graph_result),
      false_query_graph_api,
      /** @type {any} */ (contract_node),
      /** @type {any} */ (trigger_node),
    ),
  ).toMatchObject({
    job_name: 'run-after-false-condition',
    kind: 'triggered-document',
  });

  expect(
    selectRunnableDispatchJob(
      {
        ordered_jobs: [
          {
            if_query: null,
            job_name: 'transition-only',
            kind: 'document-transition',
            needs: [],
            transition_target_binding: 'document',
            transition_target_state: 'review',
          },
        ],
        trigger: {
          binding_name: 'task',
          query_text: '$class=task',
          role: 'document',
        },
      },
      /** @type {any} */ (project_graph_result),
      graph_api,
      /** @type {any} */ (contract_node),
      /** @type {any} */ (trigger_node),
    ),
  ).toBeNull();
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

it('reports malformed trigger candidates when scheduler-visible graph data omits status', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createDispatchFlowDocumentText(),
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
    flow_document_text: createDispatchFlowDocumentText(),
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
    flow_document_text: createDispatchFlowDocumentText(),
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
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    async emit_event(event) {
      emitted_events.push(event);
    },
    endpoint: '/tmp/dispatch.sock',
    graph_api: {
      async load_project_graph() {
        throw 'plain failure';
      },
      query_graph: /** @type {any} */ (queryGraph),
    },
    log_to_operator() {},
    now() {
      return new Date('2026-03-27T10:00:00.000Z');
    },
    operator_io: createIoContext(),
    repo_directory: '/repo',
    signal: undefined,
    worker_id: 'worker-helper',
  };

  await handleFollowerMessage(
    {
      assignment_id: 'assignment-plain-failure',
      await_query: '$class == $signal',
      binding_targets: {
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      decision_paths: [],
      flow_id: 'flow:single-task-flow-reconciler',
      flow_instance_id: 'flow-instance:plain-failure',
      flow_path: FLOW_PATH,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'core/codex-sdk',
        },
      ],
      task_id: 'flow-instance-plain-failure',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_conditions: {
        failure: '$class == $signal and outcome == failure',
        success: '$class == $signal and outcome == success',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      type: 'assignment',
      worktree_policy: {
        mode: 'ephemeral',
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
});

it('reports missing assignment execution context to followers', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    async emit_event(event) {
      emitted_events.push(event);
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

it('executes a state-machine assignment payload on the follower path', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {Array<Record<string, unknown>>} */
  const emitted_events = [];
  /** @type {Array<Record<string, unknown>>} */
  const sent_messages = [];
  const shared_context = {
    /** @param {Record<string, unknown>} event */
    async emit_event(event) {
      emitted_events.push(event);
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
          id: 'thread-state-machine',
          async run() {
            return createSuccessRunResult();
          },
        };
      },
    },
    worker_id: 'worker-helper',
  };

  await handleFollowerMessage(
    {
      assignment_id: 'assignment-state-machine',
      binding_targets: {
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      decision_paths: [],
      flow_instance_id: 'flow-instance:state-machine',
      flow_path: FLOW_PATH,
      ordered_jobs: [
        {
          job_name: 'implement',
          kind: 'action',
          limits: null,
          next_branches: [
            {
              condition_text: null,
              target_job_name: 'done',
            },
          ],
          uses_value: 'core/agent',
          with_value: {
            prompt: 'Implement the task in ${{ task.path }}.',
            provider: 'codex-sdk',
          },
        },
        {
          end_state: 'success',
          job_name: 'done',
          kind: 'end',
        },
      ],
      start_job_name: 'implement',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      type: 'assignment',
      workspace: {
        materialize: {
          kind: 'worktree',
          mode: 'ephemeral',
          ref: 'main',
        },
        source: {
          id: 'app',
          kind: 'repo',
        },
        type: 'git.workspace',
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
        assignment_id: 'assignment-state-machine',
        kind: 'assignment_received',
      }),
    ]),
  );
  expect(sent_messages).toEqual([
    {
      assignment_id: 'assignment-state-machine',
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
 * @param {string} file_path
 * @param {string} expected_status
 * @returns {Promise<void>}
 */
async function waitForFileStatus(file_path, expected_status) {
  for (let index = 0; index < 100; index += 1) {
    const file_text = await readFile(file_path, 'utf8');

    if (file_text.includes(`Status: ${expected_status}`)) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out while waiting for the file status.');
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
function createDispatchFlowDocumentText() {
  return [
    '---',
    'Kind: flow',
    'Id: single-task-flow-reconciler',
    'Status: proposed',
    '---',
    '# Single-Task Flow Reconciler',
    '',
    '```yaml',
    'kind: flow',
    'id: single-task-flow-reconciler',
    'status: proposed',
    'scope: contract',
    '',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    '',
    'jobs:',
    '  reconcile_first_ready_task:',
    '    worktree:',
    '      mode: ephemeral',
    '    steps:',
    '      - uses: core/codex-sdk',
    '      - await:',
    '          $class == $signal and kind == worker_completed and subject == task',
    '      - if:',
    '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
    '        transition:',
    '          target: task',
    '          status: review',
    '      - if:',
    '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
    '        transition:',
    '          target: task',
    '          status: blocked',
    '```',
    '',
  ].join('\n');
}
