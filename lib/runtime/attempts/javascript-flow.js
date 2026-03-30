/* eslint-disable max-lines, max-lines-per-function */
/** @import { BuildGraphResult, QueryGraphApi } from '../../shared/types/patram-types.ts' */
import { loadExecutableDispatchFlow } from '../../flow/reconcile-flow.js';
import { attachFlowRuntime } from '../../flow/built-ins.js';
import { isPlainObject } from '../../shared/diagnostics/validation-helpers.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { executePluginStep } from './plugin-step.js';
import {
  createPluginConsole,
  readRequiredRunId,
  resolveOperatorIo,
} from './plugin-io.js';
import {
  collectDecisionPaths,
  refreshBindingTargets,
  resolveResumeWorkspaceDefinition,
} from './resume-support.js';
import {
  cleanupStateMachineAttemptContext,
  createJavaScriptFlowResumeAttemptContext,
  createStateMachineAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  createCurrentDate,
  createDefaultBindingTargets,
  createEmptyWorkerResult,
  createRunResult,
} from './result.js';
import { prepareWorkspace } from '../workspaces/runtime-files.js';

export { resumeJavaScriptFlowAttempt, runJavaScriptFlowAttempt };

const RESUME_RUNTIME_LABEL = 'Resumed runtime';

/**
 * @param {string} repo_directory
 * @param {{
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   runtime_label: string,
 *   task_id: string,
 *   task_path: string,
 *   workspace: (
 *     | { id: string }
 *     | {
 *         id: string,
 *         location: {
 *           path: string,
 *         },
 *         mode: 'ephemeral' | 'pooled',
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *   ),
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function runJavaScriptFlowAttempt(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const binding_targets =
    options.binding_targets ??
    createDefaultBindingTargets(options.task_id, options.task_path);
  const attempt_context = await createStateMachineAttemptContext(
    repo_directory,
    {
      contract_path: options.contract_path,
      flow_instance_id: options.flow_instance_id,
      flow_path: options.flow_path,
      runtime_label: options.runtime_label,
      start_job_name: 'main',
      task_id: options.task_id,
      task_path: options.task_path,
      workspace: options.workspace,
    },
    now,
  );

  try {
    return await executeJavaScriptFlowAttempt(repo_directory, {
      approval: undefined,
      attempt_context,
      binding_targets,
      contract_path: options.contract_path,
      flow_instance_id: options.flow_instance_id,
      flow_path: options.flow_path,
      flow_state: {},
      handler_input: undefined,
      handler_name: 'main',
      now,
      operator_io: options.operator_io,
      task_id: options.task_id,
      task_path: options.task_path,
      wait_state: undefined,
    });
  } finally {
    await cleanupStateMachineAttemptContext(attempt_context);
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   durable_graph?: BuildGraphResult,
 *   graph_api?: QueryGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function resumeJavaScriptFlowAttempt(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const graph_api = resolveGraphApi(options.graph_api);
  const durable_graph =
    options.durable_graph ??
    (await graph_api.load_project_graph(repo_directory)).graph;
  const durable_attempt_context = createJavaScriptFlowResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );
  const javascript_flow = await loadJavaScriptDispatchFlow(
    repo_directory,
    durable_attempt_context.flow_path,
  );
  const refreshed_binding_targets = refreshBindingTargets(
    durable_graph,
    durable_attempt_context.binding_targets,
  );
  const decision_paths = collectDecisionPaths(
    durable_graph,
    durable_attempt_context.contract_path,
  );
  const resume_workspace = await resolveResumeWorkspaceDefinition(
    repo_directory,
    javascript_flow.workspace,
    durable_attempt_context.recorded_worktree,
  );
  const worktree_assignment = await prepareWorkspace(
    repo_directory,
    resume_workspace,
  );
  const attempt_context = {
    ...durable_attempt_context,
    binding_targets: refreshed_binding_targets,
    prompt: await createRuntimePrompt(repo_directory, {
      contract_path: durable_attempt_context.contract_path,
      decision_paths,
      flow_path: durable_attempt_context.flow_path,
      runtime_label: RESUME_RUNTIME_LABEL,
      task_path: durable_attempt_context.task_path,
    }),
    worktree_assignment,
    worktree_path: worktree_assignment.path,
  };

  try {
    return await executeJavaScriptFlowAttempt(repo_directory, {
      approval: durable_attempt_context.approval,
      attempt_context,
      binding_targets: refreshed_binding_targets,
      contract_path: durable_attempt_context.contract_path,
      flow_instance_id: durable_attempt_context.flow_instance_id,
      flow_path: durable_attempt_context.flow_path,
      flow_state: durable_attempt_context.flow_state,
      handler_input: durable_attempt_context.wait_state?.data,
      handler_name: readResumeHandlerName(durable_attempt_context),
      now,
      operator_io: options.operator_io,
      task_id: durable_attempt_context.task_id,
      task_path: durable_attempt_context.task_path,
      wait_state: durable_attempt_context.wait_state,
    });
  } finally {
    await cleanupStateMachineAttemptContext(attempt_context);
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   attempt_context: {
 *     prompt: string,
 *     run_id?: string,
 *     runtime_record_path: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   handler_input: unknown,
 *   handler_name: string,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function executeJavaScriptFlowAttempt(repo_directory, options) {
  const javascript_flow = await loadJavaScriptDispatchFlow(
    repo_directory,
    options.flow_path,
  );
  const handler = /** @type {(
   *   ctx: Record<string, unknown>,
   *   handler_input?: unknown,
   * ) => Promise<void> | void} */ (
    javascript_flow.handlers[options.handler_name]
  );

  if (typeof handler !== 'function') {
    throw new Error(
      `JavaScript flow "${options.flow_path}" does not export handler "${options.handler_name}".`,
    );
  }

  const operator_io = resolveOperatorIo(options.operator_io);
  const run_id = readRequiredRunId(options.attempt_context.run_id);
  const execution_state = {
    approval: options.approval,
    current_handler_name: options.handler_name,
    current_state: cloneValue(options.flow_state),
    durable_state: cloneValue(options.flow_state),
    wait_state: undefined,
    worker_result: createEmptyWorkerResult(null),
  };
  const runtime_record_context = createJavaScriptRuntimeRecordContext(
    options,
    execution_state,
    run_id,
  );

  await writeUnresolvedRuntimeRecord(
    runtime_record_context,
    options.attempt_context,
    null,
  );

  const ctx = createFlowContext(
    repo_directory,
    options,
    execution_state,
    javascript_flow.handlers,
    operator_io,
    runtime_record_context,
  );

  try {
    await callFlowHandlerWithRecovery(
      options,
      execution_state,
      javascript_flow.handlers,
      runtime_record_context,
      handler,
      ctx,
      options.handler_input,
    );
    await writeFinalRuntimeRecord(
      runtime_record_context,
      options.attempt_context,
      execution_state.worker_result,
      options.now,
    );

    return createRunResult(repo_directory, {
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      outcome: 'success',
      prompt: options.attempt_context.prompt,
      runtime_record_path: options.attempt_context.runtime_record_path,
      task_id: options.task_id,
      task_path: options.task_path,
      worker_result: execution_state.worker_result,
      worktree_path: options.attempt_context.worktree_path,
    });
  } catch (error) {
    if (error instanceof PendingApprovalSignal) {
      return createRunResult(repo_directory, {
        contract_path: options.contract_path,
        flow_path: options.flow_path,
        outcome: 'pending-approval',
        prompt: options.attempt_context.prompt,
        runtime_record_path: options.attempt_context.runtime_record_path,
        task_id: options.task_id,
        task_path: options.task_path,
        worker_result: execution_state.worker_result,
        worktree_path: options.attempt_context.worktree_path,
      });
    }

    execution_state.worker_result = {
      ...execution_state.worker_result,
      outcome: 'failure',
      worker_error: readErrorMessage(error),
    };
    await writeFinalRuntimeRecord(
      runtime_record_context,
      options.attempt_context,
      execution_state.worker_result,
      options.now,
    );

    return createRunResult(repo_directory, {
      contract_path: options.contract_path,
      flow_path: options.flow_path,
      outcome: 'failure',
      prompt: options.attempt_context.prompt,
      runtime_record_path: options.attempt_context.runtime_record_path,
      task_id: options.task_id,
      task_path: options.task_path,
      worker_result: execution_state.worker_result,
      worktree_path: options.attempt_context.worktree_path,
    });
  }
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeJavaScriptFlowAttempt>[1]} options
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_handler_name: string,
 *   current_state: Record<string, unknown>,
 *   durable_state: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worker_result: ReturnType<typeof createEmptyWorkerResult>,
 * }} execution_state
 * @param {Record<string, Function>} handlers
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   format_version: 'javascript-flow-v1',
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }} runtime_record_context
 * @returns {Record<string, unknown>}
 */
function createFlowContext(
  repo_directory,
  options,
  execution_state,
  handlers,
  operator_io,
  runtime_record_context,
) {
  /** @type {Record<string, unknown>} */
  const ctx = {
    bindings: cloneValue(options.binding_targets),
    console: createPluginConsole(operator_io),
    contract_path: options.contract_path,
    flow_path: options.flow_path,
    repo_directory,
    run_id: runtime_record_context.run_id,
    task_id: options.task_id,
    task_path: options.task_path,
    worktree_path: options.attempt_context.worktree_path,
  };

  Object.defineProperty(ctx, 'state', {
    enumerable: true,
    get() {
      return execution_state.current_state;
    },
  });

  for (const [binding_name, binding_target] of Object.entries(
    options.binding_targets,
  )) {
    ctx[binding_name] = binding_target;
  }

  /**
   * @param {unknown} next_state
   * @returns {Promise<void>}
   */
  ctx.setState = async (next_state) => {
    const normalized_state = readRequiredFlowState(next_state);

    execution_state.current_state = cloneValue(normalized_state);
    execution_state.durable_state = cloneValue(normalized_state);
    runtime_record_context.flow_state = execution_state.durable_state;
    await writeUnresolvedRuntimeRecord(
      runtime_record_context,
      options.attempt_context,
      null,
    );
  };

  return attachFlowRuntime(ctx, {
    approve(with_value) {
      return requestApproval(
        repo_directory,
        options,
        execution_state,
        handlers,
        runtime_record_context,
        with_value,
      );
    },
    run(with_value) {
      return invokeCoreBuiltIn(
        repo_directory,
        options,
        execution_state,
        runtime_record_context,
        'core/run',
        with_value,
      );
    },
    /* istanbul ignore next -- exercised through integration tests */
    run_codex(with_value) {
      return invokeCoreBuiltIn(
        repo_directory,
        options,
        execution_state,
        runtime_record_context,
        'core/run-codex',
        with_value,
      );
    },
  });
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeJavaScriptFlowAttempt>[1]} options
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_handler_name: string,
 *   current_state: Record<string, unknown>,
 *   durable_state: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worker_result: ReturnType<typeof createEmptyWorkerResult>,
 * }} execution_state
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   format_version: 'javascript-flow-v1',
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }} runtime_record_context
 * @param {'core/run' | 'core/run-codex'} step_name
 * @param {Record<string, unknown>} with_value
 * @returns {Promise<Record<string, unknown>>}
 */
async function invokeCoreBuiltIn(
  repo_directory,
  options,
  execution_state,
  runtime_record_context,
  step_name,
  with_value,
) {
  const plugin_result = await executePluginStep(repo_directory, {
    now: options.now,
    operator_io: options.operator_io,
    ordered_step: {
      kind: 'uses',
      step_name,
      with_value,
    },
    runtime_record_context: {
      approval: execution_state.approval,
      binding_targets: options.binding_targets,
      queue_wait: undefined,
      run_id: runtime_record_context.run_id,
    },
    worktree_path: options.attempt_context.worktree_path,
  });

  execution_state.approval = plugin_result.approval;
  runtime_record_context.approval = plugin_result.approval;

  /* istanbul ignore next -- defensive guard around core plugin protocol */
  if (plugin_result.outcome !== 'completed') {
    throw new Error(
      plugin_result.failure_message ??
        `Built-in ${step_name} produced outcome "${plugin_result.outcome}".`,
    );
  }

  const normalized_result = readBuiltInResult(step_name, plugin_result.result);

  if (step_name === 'core/run') {
    const exit_code = normalized_result.exit_code;

    if (typeof exit_code === 'number' && exit_code !== 0) {
      throw new Error(readRunFailureMessage(normalized_result, exit_code));
    }
  }

  if (
    step_name === 'core/run-codex' &&
    normalized_result.outcome === 'failure'
  ) {
    throw new Error(
      typeof normalized_result.error === 'string'
        ? normalized_result.error
        : 'Codex execution failed.',
    );
  }

  return normalized_result;
}

/**
 * @param {string} repo_directory
 * @param {Parameters<typeof executeJavaScriptFlowAttempt>[1]} options
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_handler_name: string,
 *   current_state: Record<string, unknown>,
 *   durable_state: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worker_result: ReturnType<typeof createEmptyWorkerResult>,
 * }} execution_state
 * @param {Record<string, Function>} handlers
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   format_version: 'javascript-flow-v1',
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }} runtime_record_context
 * @param {Record<string, unknown>} with_value
 * @returns {Promise<never>}
 */
async function requestApproval(
  repo_directory,
  options,
  execution_state,
  handlers,
  runtime_record_context,
  with_value,
) {
  if (typeof handlers.onApprove !== 'function') {
    throw new Error(
      `JavaScript flow "${options.flow_path}" must export onApprove(ctx, data) before calling approve(ctx, with).`,
    );
  }

  /* istanbul ignore next -- one-wait invariant is enforced by runtime state */
  if (execution_state.wait_state !== undefined) {
    throw new Error(
      'JavaScript flow instances may only hold one outstanding wait at a time.',
    );
  }

  const normalized_with = normalizeApprovalWithValue(with_value);
  const plugin_result = await executePluginStep(repo_directory, {
    now: options.now,
    operator_io: options.operator_io,
    ordered_step: {
      kind: 'uses',
      step_name: 'core/approval',
      with_value: {
        message: normalized_with.message,
        options: normalized_with.options,
        title: normalized_with.title,
      },
    },
    runtime_record_context: {
      approval: execution_state.approval,
      binding_targets: options.binding_targets,
      queue_wait: undefined,
      run_id: runtime_record_context.run_id,
    },
    worktree_path: options.attempt_context.worktree_path,
  });

  execution_state.approval = plugin_result.approval;
  runtime_record_context.approval = plugin_result.approval;

  /* istanbul ignore next -- approval core plugin always suspends unresolved runs */
  if (plugin_result.outcome !== 'pending-approval') {
    throw new Error(
      `Expected approve(ctx, with) to suspend the flow, received "${plugin_result.outcome}".`,
    );
  }

  execution_state.wait_state = {
    data: normalized_with.data,
    handler_name: 'onApprove',
    kind: 'approval',
  };
  runtime_record_context.wait_state = execution_state.wait_state;
  await writeUnresolvedRuntimeRecord(
    runtime_record_context,
    options.attempt_context,
    null,
  );

  throw new PendingApprovalSignal();
}

/**
 * @param {Parameters<typeof executeJavaScriptFlowAttempt>[1]} options
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_handler_name: string,
 *   current_state: Record<string, unknown>,
 *   durable_state: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worker_result: ReturnType<typeof createEmptyWorkerResult>,
 * }} execution_state
 * @param {string} run_id
 * @returns {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   format_version: 'javascript-flow-v1',
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }}
 */
function createJavaScriptRuntimeRecordContext(
  options,
  execution_state,
  run_id,
) {
  return {
    approval: execution_state.approval,
    binding_targets: options.binding_targets,
    contract_path: options.contract_path,
    current_handler_name: execution_state.current_handler_name,
    flow_instance_id: options.flow_instance_id,
    flow_path: options.flow_path,
    flow_state: execution_state.durable_state,
    format_version: 'javascript-flow-v1',
    run_id,
    task_id: options.task_id,
    task_path: options.task_path,
    wait_state: execution_state.wait_state,
  };
}

/**
 * @param {Awaited<ReturnType<typeof createJavaScriptFlowResumeAttemptContext>>} durable_attempt_context
 * @returns {string}
 */
function readResumeHandlerName(durable_attempt_context) {
  /* istanbul ignore next -- current runtime only resumes approval waits through this path */
  if (durable_attempt_context.wait_state?.kind === 'approval') {
    return durable_attempt_context.wait_state.handler_name;
  }

  return durable_attempt_context.current_handler_name;
}

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   handlers: Record<string, Function>,
 *   workspace: {
 *     id: string,
 *   },
 * }>}
 */
async function loadJavaScriptDispatchFlow(repo_directory, flow_path) {
  const dispatch_flow = await loadExecutableDispatchFlow(
    repo_directory,
    flow_path,
  );

  /* istanbul ignore next -- guarded by callers that route YAML flows elsewhere */
  if (dispatch_flow.surface !== 'javascript-module') {
    throw new Error(
      `Expected ${flow_path} to define a JavaScript flow module.`,
    );
  }

  const javascript_flow = dispatch_flow.flow;

  /* istanbul ignore next -- guarded by the executable flow loader contract */
  if (javascript_flow === undefined) {
    throw new Error(`Expected ${flow_path} to load JavaScript flow handlers.`);
  }

  /** @type {{
   *   handlers: Record<string, Function>,
   *   workspace: {
   *     id: string,
   *   },
   * }} */
  const validated_flow = /** @type {any} */ (javascript_flow);

  return validated_flow;
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {(ctx: Record<string, unknown>, handler_input?: unknown) => Promise<void> | void} handler
 * @param {Record<string, unknown>} ctx
 * @param {unknown} handler_input
 * @returns {Promise<void>}
 */
async function callFlowHandler(handler, ctx, handler_input) {
  if (handler_input === undefined) {
    await handler(ctx);
    return;
  }

  await handler(ctx, handler_input);
}

/**
 * @param {Parameters<typeof executeJavaScriptFlowAttempt>[1]} options
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   current_handler_name: string,
 *   current_state: Record<string, unknown>,
 *   durable_state: Record<string, unknown>,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 *   worker_result: ReturnType<typeof createEmptyWorkerResult>,
 * }} execution_state
 * @param {Record<string, Function>} handlers
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets: Record<string, { id: string, path: string, status: string }>,
 *   contract_path: string,
 *   current_handler_name: string,
 *   flow_instance_id?: string,
 *   flow_path: string,
 *   flow_state: Record<string, unknown>,
 *   format_version: 'javascript-flow-v1',
 *   run_id: string,
 *   task_id: string,
 *   task_path: string,
 *   wait_state?: {
 *     data?: unknown,
 *     handler_name: string,
 *     kind: 'approval',
 *   },
 * }} runtime_record_context
 * @param {(ctx: Record<string, unknown>, handler_input?: unknown) => Promise<void> | void} handler
 * @param {Record<string, unknown>} ctx
 * @param {unknown} handler_input
 * @returns {Promise<void>}
 */
async function callFlowHandlerWithRecovery(
  options,
  execution_state,
  handlers,
  runtime_record_context,
  handler,
  ctx,
  handler_input,
) {
  try {
    await callFlowHandler(handler, ctx, handler_input);
  } catch (error) {
    if (error instanceof PendingApprovalSignal) {
      throw error;
    }

    const on_error_handler =
      execution_state.current_handler_name === 'onError'
        ? undefined
        : handlers.onError;

    if (typeof on_error_handler !== 'function') {
      throw error;
    }

    execution_state.current_handler_name = 'onError';
    execution_state.wait_state = undefined;
    runtime_record_context.current_handler_name = 'onError';
    runtime_record_context.wait_state = undefined;
    await writeUnresolvedRuntimeRecord(
      runtime_record_context,
      options.attempt_context,
      null,
    );
    await callFlowHandler(
      /** @type {(
       *   ctx: Record<string, unknown>,
       *   handler_input?: unknown,
       * ) => Promise<void> | void} */ (on_error_handler),
      ctx,
      error,
    );
  }
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function readRequiredFlowState(value) {
  if (!isPlainObject(value)) {
    throw new Error('ctx.setState(...) expects a plain object.');
  }

  return value;
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {'core/run' | 'core/run-codex'} step_name
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function readBuiltInResult(step_name, value) {
  if (!isPlainObject(value)) {
    throw new Error(`Built-in ${step_name} returned a non-object result.`);
  }

  return value;
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {Record<string, unknown>} result
 * @param {number} exit_code
 * @returns {string}
 */
function readRunFailureMessage(result, exit_code) {
  if (typeof result.error === 'string' && result.error !== '') {
    return result.error;
  }

  if (typeof result.stderr === 'string' && result.stderr !== '') {
    return result.stderr;
  }

  return `Command exited with code ${exit_code}.`;
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {unknown} value
 * @returns {{
 *   data?: unknown,
 *   message: string,
 *   options: string[],
 *   title: string,
 * }}
 */
function normalizeApprovalWithValue(value) {
  if (!isPlainObject(value) || typeof value.title !== 'string') {
    throw new Error('approve(ctx, with) requires a string title.');
  }

  /** @type {{
   *   data?: unknown,
   *   message: string,
   *   options: string[],
   *   title: string,
   * }} */
  const normalized_with = {
    message: typeof value.message === 'string' ? value.message : '',
    options: ['approve'],
    title: value.title,
  };

  if (Array.isArray(value.options) && value.options.every(isStringValue)) {
    normalized_with.options = value.options;
  }

  if ('data' in value) {
    normalized_with.data = value.data;
  }

  return normalized_with;
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isStringValue(value) {
  return typeof value === 'string';
}

/* istanbul ignore next -- helper branch coverage is indirect through integration tests */
/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

class PendingApprovalSignal extends Error {
  constructor() {
    super('Flow is waiting for approval.');
  }
}

/**
 * @template TValue
 * @param {TValue} value
 * @returns {TValue}
 */
function cloneValue(value) {
  return globalThis.structuredClone(value);
}
