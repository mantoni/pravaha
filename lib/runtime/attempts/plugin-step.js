import { loadStepPlugin } from '../../plugin-loader.js';
import {
  createPluginConsole,
  readRequiredRunId,
  resolveOperatorIo,
  writeApprovalInstruction,
} from './plugin-io.js';

export { executePluginStep, readBindingTargets };

/**
 * @param {string} repo_directory
 * @param {{
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   ordered_step: { kind: 'uses', step_name: string, with_value?: unknown },
 *   runtime_record_context: {
 *     approval?: {
 *       approved_at: string | null,
 *       requested_at: string,
 *     },
 *     binding_targets?: {
 *       document?: { id: string, path: string, status: string },
 *       task?: { id: string, path: string, status: string },
 *     },
 *     run_id?: string,
 *   },
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed' | 'pending-approval',
 *   result: unknown,
 * }>}
 */
async function executePluginStep(repo_directory, options) {
  const plugin_result = await loadStepPlugin(
    repo_directory,
    options.ordered_step.step_name,
  );
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
   *   is_waiting_for_approval: boolean,
   * }} */
  const execution_state = {
    approval: options.runtime_record_context.approval,
    is_waiting_for_approval: false,
  };
  const plugin_hooks = createPluginHooks(
    options,
    operator_io,
    run_id,
    execution_state,
  );

  try {
    const result = await plugin_result.plugin.run({
      console: createPluginConsole(operator_io),
      dispatchFlow: plugin_hooks.dispatch_flow,
      document: binding_targets.document,
      repo_directory,
      requestApproval: plugin_hooks.request_approval,
      run_id,
      task: binding_targets.task,
      with: options.ordered_step.with_value,
      worktree_path: options.worktree_path,
    });

    return {
      approval: execution_state.approval,
      outcome: 'completed',
      result,
    };
  } catch (error) {
    if (
      execution_state.is_waiting_for_approval &&
      error instanceof PluginStepPendingApprovalSignal
    ) {
      return {
        approval: execution_state.approval,
        outcome: 'pending-approval',
        result: {},
      };
    }

    throw error;
  }
}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task?: { id: string, path: string, status: string },
 * } | undefined} binding_targets
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function readBindingTargets(binding_targets) {
  if (binding_targets?.task === undefined) {
    throw new Error('Expected plugin execution to have a bound task context.');
  }

  return {
    document: binding_targets.document,
    task: binding_targets.task,
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
 * }} execution_state
 * @returns {{
 *   dispatch_flow: (options: {
 *     flow: string,
 *     inputs?: Record<string, unknown>,
 *     wait?: boolean,
 *   }) => Promise<Record<string, unknown>>,
 *   request_approval: () => Promise<void>,
 * }}
 */
function createPluginHooks(options, operator_io, run_id, execution_state) {
  return {
    dispatch_flow: createDispatchFlow(),
    request_approval: createRequestApproval(
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
  return async (options) => {
    return {
      dispatched: true,
      flow: options.flow,
      inputs: options.inputs ?? {},
      wait: options.wait ?? false,
    };
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
 * }} execution_state
 * @returns {() => Promise<void>}
 */
function createRequestApproval(options, operator_io, run_id, execution_state) {
  return async () => {
    if (
      execution_state.approval?.approved_at !== undefined &&
      execution_state.approval.approved_at !== null
    ) {
      return;
    }

    execution_state.approval = {
      approved_at: null,
      requested_at:
        execution_state.approval?.requested_at ?? options.now().toISOString(),
    };
    execution_state.is_waiting_for_approval = true;
    writeApprovalInstruction(operator_io.stdout, run_id);
    throw new PluginStepPendingApprovalSignal();
  };
}

class PluginStepPendingApprovalSignal extends Error {}
