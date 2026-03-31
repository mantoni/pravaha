/* eslint-disable max-lines, max-lines-per-function */
import {
  createPluginConsole,
  readRequiredRunId,
  resolveOperatorIo,
  writeApprovalInstruction,
} from './plugin-io.js';

export { executePlugin };

/**
 * @param {string} repo_directory
 * @param {{
 *   approval_error_message?: string,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   plugin: {
 *     run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *     with?: {
 *       parse: (value: unknown) => unknown,
 *     },
 *   },
 *   plugin_label: string,
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       [binding_name: string]:
 *         | { id: string, path: string, status: string }
 *         | undefined,
 *     },
 *     queue_wait?: {
 *       branch_head: string,
 *       branch_ref: string,
 *       outcome: 'failure' | 'success' | null,
 *       ready_ref: string,
 *       state: 'failed' | 'succeeded' | 'waiting',
 *     },
 *     run_id?: string,
 *   },
 *   with_value?: unknown,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   failure_message?: string,
 *   outcome: 'completed' | 'failed' | 'pending-approval' | 'pending-queue',
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   result: unknown,
 * }>}
 */
async function executePlugin(repo_directory, options) {
  const run_id = readRequiredRunId(options.runtime_record_context.run_id);
  const binding_targets = readBindingTargets(
    options.runtime_record_context.binding_targets,
  );
  const operator_io = resolveOperatorIo(options.operator_io);
  /** @type {{
   *   approval?: {
   *     approved_at: string | null,
   *     requested_at: string,
   *   },
   *   failure_message?: string,
   *   is_waiting_for_approval: boolean,
   *   is_waiting_for_queue: boolean,
   *   queue_wait?: {
   *     branch_head: string,
   *     branch_ref: string,
   *     outcome: 'failure' | 'success' | null,
   *     ready_ref: string,
   *     state: 'failed' | 'succeeded' | 'waiting',
   *   },
   * }} */
  const execution_state = {
    approval: options.runtime_record_context.approval,
    is_waiting_for_approval: false,
    is_waiting_for_queue: false,
    queue_wait: options.runtime_record_context.queue_wait,
  };
  const plugin_hooks = createPluginHooks(
    options,
    operator_io,
    run_id,
    execution_state,
  );
  const parsed_with = readParsedWith(
    options.plugin,
    options.plugin_label,
    options.with_value,
  );

  try {
    const result = await options.plugin.run({
      ...binding_targets,
      console: createPluginConsole(operator_io),
      dispatchFlow: plugin_hooks.dispatch_flow,
      failRun: plugin_hooks.fail_run,
      queueWait: execution_state.queue_wait,
      repo_directory,
      requestApproval: plugin_hooks.request_approval,
      requestQueueWait: plugin_hooks.request_queue_wait,
      run_id,
      with: parsed_with,
      worktree_path: options.worktree_path,
    });

    return {
      approval: execution_state.approval,
      failure_message: execution_state.failure_message,
      outcome: 'completed',
      queue_wait: execution_state.queue_wait,
      result,
    };
  } catch (error) {
    if (
      execution_state.is_waiting_for_approval &&
      error instanceof PluginStepPendingApprovalSignal
    ) {
      return {
        approval: execution_state.approval,
        failure_message: execution_state.failure_message,
        outcome: 'pending-approval',
        queue_wait: execution_state.queue_wait,
        result: {},
      };
    }

    if (
      execution_state.is_waiting_for_queue &&
      error instanceof PluginStepPendingQueueSignal
    ) {
      return {
        approval: execution_state.approval,
        failure_message: execution_state.failure_message,
        outcome: 'pending-queue',
        queue_wait: execution_state.queue_wait,
        result: {},
      };
    }

    if (error instanceof PluginStepFailureSignal) {
      return {
        approval: execution_state.approval,
        failure_message: execution_state.failure_message,
        outcome: 'failed',
        queue_wait: execution_state.queue_wait,
        result: {},
      };
    }

    throw error;
  }
}

/**
 * @param {{
 *   with?: {
 *     parse: (value: unknown) => unknown,
 *   },
 * }} plugin_definition
 * @param {string} plugin_label
 * @param {unknown} with_value
 * @returns {unknown}
 */
function readParsedWith(plugin_definition, plugin_label, with_value) {
  if (plugin_definition.with === undefined) {
    if (with_value !== undefined) {
      throw new Error(`Plugin "${plugin_label}" does not accept with input.`);
    }

    return undefined;
  }

  return plugin_definition.with.parse(with_value);
}

/**
 * @param {{
 *   [binding_name: string]:
 *     | { id: string, path: string, status: string }
 *     | undefined,
 * } | undefined} binding_targets
 * @returns {Record<string, { id: string, path: string, status: string }>}
 */
function readBindingTargets(binding_targets) {
  if (binding_targets === undefined) {
    throw new Error(
      'Expected plugin execution to have exactly one bound owner context.',
    );
  }

  const binding_entries = Object.entries(binding_targets).filter(
    ([, binding_target]) => binding_target !== undefined,
  );

  if (binding_entries.length !== 1) {
    throw new Error(
      `Expected plugin execution to have exactly one bound owner context, found ${binding_entries.length}.`,
    );
  }

  const [binding_entry] = binding_entries;
  const binding_target = binding_entry[1];

  if (binding_target === undefined) {
    throw new Error(
      'Expected plugin execution to have exactly one bound owner context.',
    );
  }

  return {
    [binding_entry[0]]: binding_target,
  };
}

/**
 * @param {{
 *   approval_error_message?: string,
 *   now: () => Date,
 * }} options
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @param {string} run_id
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   failure_message?: string,
 *   is_waiting_for_approval: boolean,
 *   is_waiting_for_queue: boolean,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 * }} execution_state
 * @returns {{
 *   dispatch_flow: (options: {
 *     flow: string,
 *     inputs?: Record<string, unknown>,
 *     wait?: boolean,
 *   }) => Promise<Record<string, unknown>>,
 *   fail_run: (error_message: string) => Promise<never>,
 *   request_approval: () => Promise<void>,
 *   request_queue_wait: (queue_wait: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   }) => Promise<void>,
 * }}
 */
function createPluginHooks(options, operator_io, run_id, execution_state) {
  return {
    dispatch_flow: createDispatchFlow(),
    fail_run: createFailRun(execution_state),
    request_approval: createRequestApproval(
      options,
      operator_io,
      run_id,
      execution_state,
    ),
    request_queue_wait: createRequestQueueWait(
      options,
      operator_io,
      run_id,
      execution_state,
    ),
  };
}

/**
 * @returns {(options: {
 *   flow: string,
 *   inputs?: Record<string, unknown>,
 *   wait?: boolean,
 * }) => Promise<Record<string, unknown>>}
 */
function createDispatchFlow() {
  return (options) =>
    Promise.resolve({
      dispatched: true,
      flow: options.flow,
      inputs: options.inputs ?? {},
      wait: options.wait ?? false,
    });
}

/**
 * @param {{
 *   approval_error_message?: string,
 *   now: () => Date,
 * }} options
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @param {string} run_id
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   failure_message?: string,
 *   is_waiting_for_approval: boolean,
 * }} execution_state
 * @returns {() => Promise<void>}
 */
function createRequestApproval(options, operator_io, run_id, execution_state) {
  return () => {
    if (typeof options.approval_error_message === 'string') {
      execution_state.failure_message = options.approval_error_message;
      return Promise.reject(
        new PluginStepFailureSignal(options.approval_error_message),
      );
    }

    if (
      execution_state.approval?.approved_at !== undefined &&
      execution_state.approval.approved_at !== null
    ) {
      return Promise.resolve();
    }

    execution_state.approval = {
      approved_at: null,
      requested_at:
        execution_state.approval?.requested_at ?? options.now().toISOString(),
    };
    execution_state.is_waiting_for_approval = true;
    writeApprovalInstruction(operator_io.stdout, run_id);
    return Promise.reject(new PluginStepPendingApprovalSignal());
  };
}

class PluginStepPendingApprovalSignal extends Error {}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   failure_message?: string,
 *   is_waiting_for_approval: boolean,
 *   is_waiting_for_queue: boolean,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 * }} execution_state
 * @returns {(error_message: string) => Promise<never>}
 */
function createFailRun(execution_state) {
  return (error_message) => {
    execution_state.failure_message = error_message;

    return Promise.reject(new PluginStepFailureSignal(error_message));
  };
}

/**
 * @param {{
 *   now: () => Date,
 * }} options
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @param {string} run_id
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   is_waiting_for_approval: boolean,
 *   is_waiting_for_queue: boolean,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 * }} execution_state
 * @returns {(queue_wait: {
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * }) => Promise<void>}
 */
function createRequestQueueWait(options, operator_io, run_id, execution_state) {
  return (queue_wait) => {
    void options;
    void operator_io;
    void run_id;
    execution_state.queue_wait = queue_wait;
    execution_state.is_waiting_for_queue = true;
    return Promise.reject(new PluginStepPendingQueueSignal());
  };
}

class PluginStepPendingQueueSignal extends Error {}
class PluginStepFailureSignal extends Error {}
