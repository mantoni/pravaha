/* eslint-disable max-lines, max-lines-per-function */
import { loadStepPlugin } from '../../plugin-loader.js';
import {
  createPluginConsole,
  readRequiredRunId,
  readSignalSubjects,
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
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   outcome: 'completed' | 'pending-approval',
 *   result: unknown,
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
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
  const runtime_signals = [...options.runtime_signals];
  const operator_io = resolveOperatorIo(options.operator_io);
  /** @type {{
   *   approval?: {
   *     approved_at: string | null,
   *     requested_at: string,
   *   },
   *   did_complete_on_emit: boolean,
   *   is_waiting_for_approval: boolean,
   * }} */
  const execution_state = {
    approval: options.runtime_record_context.approval,
    did_complete_on_emit: false,
    is_waiting_for_approval: false,
  };
  const plugin_hooks = createPluginHooks(
    options,
    plugin_result,
    binding_targets,
    runtime_signals,
    run_id,
    operator_io,
    execution_state,
  );
  let plugin_result_value;

  try {
    plugin_result_value = await plugin_result.plugin.run({
      console: createPluginConsole(operator_io),
      document: binding_targets.document,
      emit: plugin_hooks.emit_signal,
      repo_directory,
      requestApproval: plugin_hooks.request_approval,
      run_id,
      task: binding_targets.task,
      with: options.ordered_step.with_value,
      worktree_path: options.worktree_path,
    });
  } catch (error) {
    const signal_outcome = readPluginSignalOutcome(
      error,
      execution_state,
      runtime_signals,
    );

    if (signal_outcome !== null) {
      return {
        approval: execution_state.approval,
        ...signal_outcome,
      };
    }

    throw error;
  }

  return {
    approval: execution_state.approval,
    outcome: 'completed',
    result: plugin_result_value,
    runtime_signals,
  };
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
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   ordered_step: { kind: 'uses', step_name: string, with_value?: unknown },
 * }} options
 * @param {{
 *   plugin: {
 *     emits: Record<string, import('zod').ZodType>,
 *   },
 * }} plugin_result
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }} binding_targets
 * @param {Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * }>} runtime_signals
 * @param {string} run_id
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   did_complete_on_emit: boolean,
 *   is_waiting_for_approval: boolean,
 * }} execution_state
 * @returns {{
 *   emit_signal: (signal_kind: string, payload: unknown) => Promise<void>,
 *   request_approval: () => Promise<void>,
 * }}
 */
function createPluginHooks(
  options,
  plugin_result,
  binding_targets,
  runtime_signals,
  run_id,
  operator_io,
  execution_state,
) {
  return {
    emit_signal: createEmitSignal(
      options,
      plugin_result,
      readSignalSubjects(binding_targets),
      runtime_signals,
      run_id,
      execution_state,
    ),
    request_approval: createRequestApproval(
      options,
      operator_io,
      run_id,
      execution_state,
    ),
  };
}

/**
 * @param {{
 *   now: () => Date,
 *   ordered_step: { kind: 'uses', step_name: string, with_value?: unknown },
 * }} options
 * @param {{
 *   plugin: {
 *     emits: Record<string, import('zod').ZodType>,
 *   },
 * }} plugin_result
 * @param {('document' | 'task')[]} signal_subjects
 * @param {Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * }>} runtime_signals
 * @param {string} run_id
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   did_complete_on_emit: boolean,
 *   is_waiting_for_approval: boolean,
 * }} execution_state
 * @returns {(signal_kind: string, payload: unknown) => Promise<void>}
 */
function createEmitSignal(
  options,
  plugin_result,
  signal_subjects,
  runtime_signals,
  run_id,
  execution_state,
) {
  return async (signal_kind, payload) => {
    const signal_schema = plugin_result.plugin.emits[signal_kind];

    if (signal_schema === undefined) {
      throw new Error(
        `Plugin "${options.ordered_step.step_name}" cannot emit undeclared signal "${signal_kind}".`,
      );
    }

    const parsed_payload = signal_schema.parse(payload);
    const emitted_at = options.now().toISOString();

    for (const subject of signal_subjects) {
      runtime_signals.push({
        emitted_at,
        kind: signal_kind,
        payload: parsed_payload,
        run_id,
        subject,
      });
    }

    execution_state.did_complete_on_emit = true;
    throw new PluginStepCompletedSignal();
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
 *   did_complete_on_emit: boolean,
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

/**
 * @param {unknown} error
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   did_complete_on_emit: boolean,
 *   is_waiting_for_approval: boolean,
 * }} execution_state
 * @param {Array<{
 *   emitted_at: string,
 *   kind: string,
 *   payload: Record<string, unknown>,
 *   run_id?: string,
 *   subject: 'document' | 'task',
 * }>} runtime_signals
 * @returns {{
 *   outcome: 'completed' | 'pending-approval',
 *   result: unknown,
 *   runtime_signals: Array<{
 *     emitted_at: string,
 *     kind: string,
 *     payload: Record<string, unknown>,
 *     run_id?: string,
 *     subject: 'document' | 'task',
 *   }>,
 * } | null}
 */
function readPluginSignalOutcome(error, execution_state, runtime_signals) {
  if (
    execution_state.did_complete_on_emit &&
    error instanceof PluginStepCompletedSignal
  ) {
    return {
      outcome: 'completed',
      result: {},
      runtime_signals,
    };
  }

  if (
    execution_state.is_waiting_for_approval &&
    error instanceof PluginStepPendingApprovalSignal
  ) {
    return {
      outcome: 'pending-approval',
      result: {},
      runtime_signals,
    };
  }

  return null;
}

class PluginStepCompletedSignal extends Error {}
class PluginStepPendingApprovalSignal extends Error {}
