/** @import { Socket } from 'node:net' */
/** @import * as DispatchProtocolModule from '../lib/runtime/dispatch/protocol.js' */
import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, expect, it, vi } from 'vitest';

import {
  createIoContext,
  createResumeFixtureRepo,
  createResumeRuntimeRecord,
  createResumeWorkerClient,
} from './split-module-coverage.helpers.js';
import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from '../lib/plugin.fixture-test-helpers.js';
import { executeStateMachineAction } from '../lib/runtime/attempts/core-actions.js';
import { executeStateMachineAttempt } from '../lib/runtime/attempts/state-machine-execution.js';
import { runRuntimeCommandWithOptions } from '../lib/cli/runtime-command.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('../lib/pravaha.js');
  vi.doUnmock('../lib/reconcile-graph.js');
  vi.doUnmock('../lib/runtime/dispatch/context.js');
  vi.doUnmock('../lib/runtime/dispatch/dispatcher.js');
  vi.doUnmock('../lib/runtime/dispatch/protocol.js');
});

it('writes failure outcomes and caught runtime errors through runtime-command helpers', async () => {
  const failure_io_context = createIoContext();
  const error_io_context = createIoContext();

  await expect(
    runRuntimeCommandWithOptions(
      '/repo',
      failure_io_context,
      async () => ({ outcome: 'failure' }),
      { reason: 'broken' },
    ),
  ).resolves.toBe(1);
  await expect(
    runRuntimeCommandWithOptions(
      '/repo',
      error_io_context,
      async () => {
        throw new Error('runtime boom');
      },
      {},
    ),
  ).resolves.toBe(1);

  expect(failure_io_context.stderr_text()).toContain('"outcome": "failure"');
  expect(error_io_context.stderr_text()).toContain('runtime boom');
});

it('covers explicit CLI command contexts and successful validation output', async () => {
  const io_context = createIoContext();
  const dispatch_mock = vi.fn(async () => createDispatchResult());
  const validate_repo_mock = vi.fn(async () =>
    createSuccessfulValidationResult(),
  );
  const worker_mock = vi.fn(async () => createStoppedWorkerResult());

  vi.doMock('../lib/pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: vi.fn(),
    validateRepo: validate_repo_mock,
    worker: vi.fn(),
  }));

  const { runDispatchCommand } =
    await import('../lib/cli/commands/dispatch.js');
  const { runValidateCommand } =
    await import('../lib/cli/commands/validate.js');
  const { runWorkerCommand } = await import('../lib/cli/commands/worker.js');

  await expect(
    runDispatchCommand([], io_context, { dispatch: dispatch_mock }),
  ).resolves.toBe(0);
  await expect(runValidateCommand(['/repo'], io_context)).resolves.toBe(0);
  await expect(
    runWorkerCommand([], io_context, { worker: worker_mock }),
  ).resolves.toBe(0);

  expect(dispatch_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(validate_repo_mock).toHaveBeenCalledWith('/repo');
  expect(worker_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(io_context.stdout_text()).toContain('Validation passed.');
});

it('covers default migrated CLI command implementations when command context is omitted', async () => {
  const io_context = createIoContext();
  const dispatch_mock = vi.fn(async () => createDispatchResult());
  const validate_repo_mock = vi.fn(async () =>
    createSuccessfulValidationResult(),
  );
  const worker_mock = vi.fn(async () => createStoppedWorkerResult());

  vi.doMock('../lib/pravaha.js', () => ({
    approve: vi.fn(),
    definePlugin: vi.fn(),
    dispatch: dispatch_mock,
    validateRepo: validate_repo_mock,
    worker: worker_mock,
  }));

  const { runDispatchCommand } =
    await import('../lib/cli/commands/dispatch.js');
  const { runValidateCommand } =
    await import('../lib/cli/commands/validate.js');
  const { runWorkerCommand } = await import('../lib/cli/commands/worker.js');

  await expect(runDispatchCommand([], io_context, {})).resolves.toBe(0);
  await expect(runValidateCommand([], io_context)).resolves.toBe(0);
  await expect(runWorkerCommand([], io_context, {})).resolves.toBe(0);

  expect(dispatch_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  expect(validate_repo_mock).toHaveBeenCalledWith(process.cwd());
  expect(worker_mock).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
});

it('fails clearly when plugin execution has no stable run id', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/no-run-id.js': createPluginModuleSource({
        emits_source: '{}',
        run_source: '    return { ok: true };',
      }),
    }),
  });

  try {
    await expect(
      executeStateMachineAction(temp_directory, {
        approval: undefined,
        base_prompt: 'prompt',
        current_job_name: 'inspect',
        jobs_context: {},
        now: () => new Date('2026-03-28T10:00:00.000Z'),
        run_id: null,
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
        uses_value: 'local/no-run-id',
        with_value: {},
        worker_client: {
          startThread() {
            throw new Error('local plugin execution should not start a worker');
          },
        },
        worker_thread_id: null,
        worktree_path: temp_directory,
      }),
    ).rejects.toThrow('Expected a stable run id for plugin execution.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails clearly when the extracted execution loop receives an unknown current job', async () => {
  await expect(
    executeStateMachineAttempt('/repo', {
      attempt_context: {
        prompt: 'prompt',
        runtime_record_path: '/repo/.pravaha/runtime/demo.json',
        worktree_assignment: {
          identity: 'worktree-1',
          mode: 'pooled',
          path: '/repo/.pravaha/worktrees/demo',
        },
        worktree_path: '/repo/.pravaha/worktrees/demo',
      },
      now: () => new Date('2026-03-28T10:00:00.000Z'),
      ordered_jobs: [],
      runtime_record_context: {
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: 'docs/contracts/runtime/job-state-machine-execution.md',
        current_job_name: 'missing',
        flow_path: 'docs/flows/runtime/test.yaml',
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {},
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
      worker_client: {
        startThread() {
          throw new Error('unknown jobs should fail before worker startup');
        },
      },
    }),
  ).rejects.toThrow('Unknown state-machine job "missing".');
});

it('falls back to startThread when a resumed state-machine attempt has no worker thread id', async () => {
  const temp_directory = await createResumeFixtureRepo();
  /** @type {string[]} */
  const started_threads = [];
  /** @type {string[]} */
  const resumed_threads = [];

  try {
    const { resumeTaskAttempt } = await import('../lib/runtime-attempt.js');

    await expect(
      resumeTaskAttempt(temp_directory, {
        runtime_record: createResumeRuntimeRecord(temp_directory),
        runtime_record_path: join(temp_directory, '.pravaha/runtime/demo.json'),
        worker_client: createResumeWorkerClient(
          started_threads,
          resumed_threads,
        ),
      }),
    ).resolves.toMatchObject({
      outcome: 'success',
    });

    expect(started_threads).toEqual(['started']);
    expect(resumed_threads).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports string protocol errors and rejects malformed assignment completion payloads', async () => {
  const io_context = createIoContext();
  const dispatch_protocol = await loadProtocolModule();

  dispatch_protocol.reportOperatorError(io_context, 'protocol string failure');
  expect(io_context.stderr_text()).toBe('protocol string failure\n');

  expect(() =>
    dispatch_protocol.parseProtocolMessage(
      '{"type":"assignment_completed","assignment_id":"run-1"}',
    ),
  ).toThrow(
    'Expected assignment_completed to include assignment_id and worker_id.',
  );
  expect(() =>
    dispatch_protocol.parseProtocolMessage(
      '{"type":"assignment_failed","assignment_id":"run-1","worker_id":"worker-a"}',
    ),
  ).toThrow(
    'Expected assignment_failed to include assignment_id, error, and worker_id.',
  );
  expect(() =>
    dispatch_protocol.parseProtocolMessage('{"type":"notify_dispatch"}'),
  ).toThrow('Expected notify_dispatch to include source.');
  expect(() =>
    dispatch_protocol.parseProtocolMessage('{"type":"dispatch_notified"}'),
  ).toThrow('Expected dispatch_notified to include dispatcher_id.');
  expect(() =>
    dispatch_protocol.parseProtocolMessage(
      '{"type":"assignment_pending_approval","assignment_id":"run-1"}',
    ),
  ).toThrow(
    'Expected assignment_pending_approval to include assignment_id and worker_id.',
  );
});

it('destroys protocol connections for queued handler failures and non-Error destroys', async () => {
  const dispatch_protocol = await loadProtocolModule();
  const socket = createMockSocket();
  const protocol_connection = dispatch_protocol.createProtocolConnection(
    /** @type {Socket} */ (/** @type {unknown} */ (socket)),
  );

  protocol_connection.setMessageHandler(() => {
    return Promise.reject('handler boom');
  });
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
  const dispatch_protocol = await loadProtocolModule();
  const socket = createMockSocket();
  const protocol_connection = dispatch_protocol.createProtocolConnection(
    /** @type {Socket} */ (/** @type {unknown} */ (socket)),
  );
  const next_message = protocol_connection.nextMessage();

  socket.end();

  await expect(next_message).rejects.toThrow(
    'The local dispatch connection closed before a message arrived.',
  );
});

it('covers helper branches for resumed worker clients', async () => {
  /** @type {string[]} */
  const started_threads = [];
  /** @type {string[]} */
  const resumed_threads = [];
  const worker_client = createResumeWorkerClient(
    started_threads,
    resumed_threads,
  );

  const resumed_thread = worker_client.resumeThread('thread-resume');
  const started_thread = worker_client.startThread();

  await expect(resumed_thread.run('input')).resolves.toMatchObject({
    finalResponse: 'unused',
    id: 'thread-resume',
  });
  await expect(started_thread.run('input')).resolves.toMatchObject({
    finalResponse: 'completed',
    id: null,
  });
  expect(resumed_threads).toEqual(['thread-resume']);
  expect(started_threads).toEqual(['started']);
});

function createMockSocket() {
  const emitter = new EventEmitter();
  const socket = {
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
  return socket;
}

/**
 * @returns {Promise<void>}
 */
async function waitForMicrotask() {
  await Promise.resolve();
}

/**
 * @returns {{
 *   dispatcher_available: false,
 *   dispatcher_id: null,
 *   endpoint: string,
 *   notification_delivered: false,
 *   outcome: 'success',
 * }}
 */
function createDispatchResult() {
  return {
    dispatcher_available: false,
    dispatcher_id: null,
    endpoint: '/repo/.pravaha/dispatch/leader.sock',
    notification_delivered: false,
    outcome: 'success',
  };
}

/**
 * @returns {{ checked_flow_count: number, diagnostics: never[] }}
 */
function createSuccessfulValidationResult() {
  return {
    checked_flow_count: 1,
    diagnostics: [],
  };
}

/**
 * @returns {{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   outcome: 'stopped',
 *   role: 'dispatcher',
 *   worker_id: string,
 * }}
 */
function createStoppedWorkerResult() {
  return {
    dispatcher_id: 'worker-explicit',
    endpoint: '/repo/.pravaha/dispatch/leader.sock',
    outcome: 'stopped',
    role: 'dispatcher',
    worker_id: 'worker-explicit',
  };
}

/** @returns {Promise<typeof DispatchProtocolModule>} */
async function loadProtocolModule() {
  return import('../lib/runtime/dispatch/protocol.js');
}
