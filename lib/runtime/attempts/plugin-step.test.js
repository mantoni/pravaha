import { beforeEach, expect, it, vi } from 'vitest';

import { executePlugin } from './plugin-step.js';

beforeEach(() => {});

it('executes plugins with a single bound owner context and dispatch hook', async () => {
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          run(context) {
            expect(context.doc).toEqual({
              id: 'task:demo',
              path: 'docs/tasks/runtime/demo.md',
              status: 'ready',
            });

            return readDispatchFlow(context)({
              flow: 'docs/flows/runtime/review.js',
              inputs: {
                scope: 'demo',
              },
              wait: true,
            });
          },
        }),
      }),
    ),
  ).resolves.toEqual({
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

  await expect(
    executePlugin(
      '/repo',
      createOptions({
        operator_io: { stderr: stdout, stdout },
        plugin: createPluginDefinition({
          async run(context) {
            await readRequestApproval(context)();
            return {};
          },
        }),
      }),
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
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          async run(context) {
            await readRequestApproval(context)();
            return {
              retried: true,
            };
          },
        }),
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
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          async run(context) {
            await readRequestQueueWait(context)({
              branch_head: 'branch-head',
              branch_ref: 'refs/heads/review/demo',
              outcome: null,
              ready_ref: 'refs/queue/ready/0001-review-demo',
              state: 'waiting',
            });
            return {};
          },
        }),
      }),
    ),
  ).resolves.toMatchObject({
    outcome: 'pending-queue',
    queue_wait: {
      ready_ref: 'refs/queue/ready/0001-review-demo',
      state: 'waiting',
    },
  });
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          run(context) {
            return readFailRun(context)('Queue validation failed.');
          },
        }),
      }),
    ),
  ).resolves.toMatchObject({
    failure_message: 'Queue validation failed.',
    outcome: 'failed',
  });
});

// eslint-disable-next-line max-lines-per-function
it('rejects missing or ambiguous owner bindings', async () => {
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          run() {
            return {};
          },
        }),
        runtime_record_context: {
          binding_targets: undefined,
        },
      }),
    ),
  ).rejects.toThrow(
    'Expected plugin execution to have exactly one bound owner context.',
  );
  await expect(
    executePlugin(
      '/repo',
      createOptions({
        plugin: createPluginDefinition({
          run() {
            return {};
          },
        }),
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
 *   plugin?: {
 *     run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *     with?: {
 *       parse: (value: unknown) => unknown,
 *     },
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
  /** @type {Parameters<typeof executePlugin>[1]} */
  const base_options = {
    now: () => new Date('2026-03-31T10:00:00.000Z'),
    plugin: createPluginDefinition({
      run() {
        return {};
      },
    }),
    plugin_label: 'test/plugin',
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
    with_value: {
      branch: 'review/demo',
    },
    worktree_path: '/tmp/worktree',
  };

  /** @type {Parameters<typeof executePlugin>[1]} */
  return {
    ...base_options,
    ...overrides,
    runtime_record_context: {
      ...base_options.runtime_record_context,
      ...overrides.runtime_record_context,
    },
  };
}

/**
 * @param {{
 *   run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 * }} options
 * @returns {{
 *   run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *   with: {
 *     parse: (value: unknown) => unknown,
 *   },
 * }}
 */
function createPluginDefinition(options) {
  return {
    run: options.run,
    with: {
      /**
       * @param {unknown} value
       * @returns {unknown}
       */
      parse(value) {
        return value;
      },
    },
  };
}

/**
 * @param {Record<string, unknown>} context
 * @returns {(payload: {
 *   flow: string,
 *   inputs?: Record<string, unknown>,
 *   wait?: boolean,
 * }) => Promise<unknown>}
 */
function readDispatchFlow(context) {
  /** @type {{ dispatchFlow: (payload: {
   *   flow: string,
   *   inputs?: Record<string, unknown>,
   *   wait?: boolean,
   * }) => Promise<unknown> }} */
  const runtime_context = /** @type {any} */ (context);

  return runtime_context.dispatchFlow;
}

/**
 * @param {Record<string, unknown>} context
 * @returns {(message: string) => Promise<unknown>}
 */
function readFailRun(context) {
  /** @type {{ failRun: (message: string) => Promise<unknown> }} */
  const runtime_context = /** @type {any} */ (context);

  return runtime_context.failRun;
}

/**
 * @param {Record<string, unknown>} context
 * @returns {() => Promise<unknown>}
 */
function readRequestApproval(context) {
  /** @type {{ requestApproval: () => Promise<unknown> }} */
  const runtime_context = /** @type {any} */ (context);

  return runtime_context.requestApproval;
}

/**
 * @param {Record<string, unknown>} context
 * @returns {(queue_wait: {
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * }) => Promise<unknown>}
 */
function readRequestQueueWait(context) {
  /** @type {{ requestQueueWait: (queue_wait: {
   *   branch_head: string,
   *   branch_ref: string,
   *   outcome: 'failure' | 'success' | null,
   *   ready_ref: string,
   *   state: 'failed' | 'succeeded' | 'waiting',
   * }) => Promise<unknown> }} */
  const runtime_context = /** @type {any} */ (context);

  return runtime_context.requestQueueWait;
}
