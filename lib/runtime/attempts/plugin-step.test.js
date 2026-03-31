/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { expect, it, vi, beforeEach } from 'vitest';

const { loadStepPlugin } = vi.hoisted(() => {
  return {
    loadStepPlugin: vi.fn(),
  };
});

vi.mock('../../plugins/plugin-loader.js', () => {
  return {
    loadStepPlugin,
  };
});

const { executePluginStep } = await import('./plugin-step.js');

beforeEach(() => {
  loadStepPlugin.mockReset();
});

it('executes plugins with a single bound owner context and dispatch hook', async () => {
  loadStepPlugin.mockResolvedValue({
    plugin: {
      /**
       * @param {any} context
       */
      run(context) {
        expect(context.doc).toEqual({
          id: 'task:demo',
          path: 'docs/tasks/runtime/demo.md',
          status: 'ready',
        });

        return context.dispatchFlow({
          flow: 'docs/flows/runtime/review.js',
          inputs: {
            scope: 'demo',
          },
          wait: true,
        });
      },
    },
  });

  await expect(executePluginStep('/repo', createOptions())).resolves.toEqual({
    approval: undefined,
    failure_message: undefined,
    outcome: 'completed',
    queue_wait: undefined,
    result: {
      dispatched: true,
      flow: 'docs/flows/runtime/review.js',
      inputs: {
        scope: 'demo',
      },
      wait: true,
    },
  });
});

it('returns a pending approval result when the plugin requests approval', async () => {
  const stdout = {
    write: vi.fn(() => true),
  };

  loadStepPlugin.mockResolvedValue({
    plugin: {
      /**
       * @param {any} context
       */
      async run(context) {
        await context.requestApproval();
        return {};
      },
    },
  });

  await expect(
    executePluginStep(
      '/repo',
      createOptions({ operator_io: { stderr: stdout, stdout } }),
    ),
  ).resolves.toMatchObject({
    approval: {
      approved_at: null,
      requested_at: '2026-03-31T10:00:00.000Z',
    },
    outcome: 'pending-approval',
  });
  expect(stdout.write).toHaveBeenCalledWith(
    'Approval requested. Run `pravaha approve --token run:demo` to continue.\n',
  );
});

it('treats already-approved runs as completed when approval is requested again', async () => {
  loadStepPlugin.mockResolvedValue({
    plugin: {
      /**
       * @param {any} context
       */
      async run(context) {
        await context.requestApproval();
        return {
          retried: true,
        };
      },
    },
  });

  await expect(
    executePluginStep(
      '/repo',
      createOptions({
        runtime_record_context: {
          approval: {
            approved_at: '2026-03-31T10:05:00.000Z',
            requested_at: '2026-03-31T10:00:00.000Z',
          },
        },
      }),
    ),
  ).resolves.toMatchObject({
    outcome: 'completed',
    result: {
      retried: true,
    },
  });
});

it('returns pending queue and failed outcomes for queue waits and failRun', async () => {
  loadStepPlugin
    .mockResolvedValueOnce({
      plugin: {
        /**
         * @param {any} context
         */
        async run(context) {
          await context.requestQueueWait({
            branch_head: 'branch-head',
            branch_ref: 'refs/heads/review/demo',
            outcome: null,
            ready_ref: 'refs/queue/ready/0001-review-demo',
            state: 'waiting',
          });
          return {};
        },
      },
    })
    .mockResolvedValueOnce({
      plugin: {
        /**
         * @param {any} context
         */
        run(context) {
          return context.failRun('Queue validation failed.');
        },
      },
    });

  await expect(
    executePluginStep('/repo', createOptions()),
  ).resolves.toMatchObject({
    outcome: 'pending-queue',
    queue_wait: {
      ready_ref: 'refs/queue/ready/0001-review-demo',
      state: 'waiting',
    },
  });
  await expect(
    executePluginStep('/repo', createOptions()),
  ).resolves.toMatchObject({
    failure_message: 'Queue validation failed.',
    outcome: 'failed',
  });
});

it('rejects missing or ambiguous owner bindings', async () => {
  loadStepPlugin.mockResolvedValue({
    plugin: {
      run() {
        return {};
      },
    },
  });

  await expect(
    executePluginStep(
      '/repo',
      createOptions({
        runtime_record_context: {
          binding_targets: undefined,
        },
      }),
    ),
  ).rejects.toThrow(
    'Expected plugin execution to have exactly one bound owner context.',
  );
  await expect(
    executePluginStep(
      '/repo',
      createOptions({
        runtime_record_context: {
          binding_targets: {
            contract: {
              id: 'contract:demo',
              path: 'docs/contracts/runtime/demo.md',
              status: 'active',
            },
            doc: {
              id: 'task:demo',
              path: 'docs/tasks/runtime/demo.md',
              status: 'ready',
            },
          },
        },
      }),
    ),
  ).rejects.toThrow(
    'Expected plugin execution to have exactly one bound owner context, found 2.',
  );
});

/**
 * @param {{
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   runtime_record_context?: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       [binding_name: string]:
 *         | { id: string, path: string, status: string }
 *         | undefined,
 *     },
 *     run_id?: string,
 *   },
 * }} [overrides]
 */
function createOptions(overrides = {}) {
  /** @type {Parameters<typeof executePluginStep>[1]} */
  const base_options = {
    now: () => new Date('2026-03-31T10:00:00.000Z'),
    ordered_step: {
      kind: 'uses',
      step_name: 'core/queue-handoff',
      with_value: {
        branch: 'review/demo',
      },
    },
    runtime_record_context: {
      approval: undefined,
      binding_targets: {
        doc: {
          id: 'task:demo',
          path: 'docs/tasks/runtime/demo.md',
          status: 'ready',
        },
      },
      run_id: 'run:demo',
    },
    worktree_path: '/tmp/worktree',
  };

  /** @type {Parameters<typeof executePluginStep>[1]} */
  return {
    ...base_options,
    ...overrides,
    runtime_record_context: {
      ...base_options.runtime_record_context,
      ...overrides.runtime_record_context,
    },
  };
}
