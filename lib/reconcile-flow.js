/* eslint-disable complexity, max-lines, max-lines-per-function */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  normalizeFlowQuery,
  resolveSelectQueryRole,
  usesQuerySyntax,
} from './flow-query.js';
import { parseFlowDefinition } from './load-flow-definition.js';
import { isPlainObject } from './validation-helpers.js';

const SUPPORTED_TASK_USE_STEPS = new Set([
  'core/lease-task',
  'core/setup-worktree',
  'core/codex-sdk',
]);
const REQUIRED_TASK_USE_STEPS = new Set(['core/lease-task', 'core/codex-sdk']);
const SUPPORTED_TRANSITION_USE_STEPS = new Set(['core/request-review']);
const SUPPORTED_TRANSITION_TARGETS = new Set(['document', 'task']);

export { loadSupportedFlow, loadSupportedJob };

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   ordered_jobs: Array<
 *     | {
 *         await_query: string,
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'selected-task',
 *         needs: string[],
 *         ordered_steps: Array<
 *           | { command_text: string, kind: 'run' }
 *           | { kind: 'uses', step_name: string }
 *         >,
 *         select_query: string,
 *         select_role: string,
 *         transition_conditions: { failure: string, success: string },
 *         transition_target_bindings: { failure: string, success: string },
 *         transition_targets: { failure: string, success: string },
 *         worktree_policy:
 *           | { mode: 'ephemeral' }
 *           | { mode: 'named', slot: string },
 *       }
 *     | {
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'document-transition',
 *         needs: string[],
 *         transition_target_binding: 'document',
 *         transition_target_state: string,
 *       }
 *   >,
 * }>}
 */
async function loadSupportedFlow(repo_directory, flow_path) {
  const flow_document_text = await readFile(
    join(repo_directory, flow_path),
    'utf8',
  );
  const parse_result = parseFlowDefinition(flow_document_text, flow_path);

  if (
    parse_result.diagnostics.length > 0 ||
    parse_result.flow_definition === null
  ) {
    throw new Error(formatDiagnostics(parse_result.diagnostics));
  }

  return interpretSupportedFlow(parse_result.flow_definition, flow_path);
}

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   await_query: string,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string }
 *   >,
 *   select_query: string,
 *   select_role: string,
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worktree_policy:
 *     | { mode: 'ephemeral' }
 *     | { mode: 'named', slot: string },
 * }>}
 */
async function loadSupportedJob(repo_directory, flow_path) {
  const flow_document_text = await readFile(
    join(repo_directory, flow_path),
    'utf8',
  );
  const parse_result = parseFlowDefinition(flow_document_text, flow_path);

  if (
    parse_result.diagnostics.length > 0 ||
    parse_result.flow_definition === null
  ) {
    throw new Error(formatDiagnostics(parse_result.diagnostics));
  }

  if (!isPlainObject(parse_result.flow_definition.jobs)) {
    throw new Error(`Expected ${flow_path} to define a jobs mapping.`);
  }

  if (Object.keys(parse_result.flow_definition.jobs).length !== 1) {
    throw new Error(`Expected ${flow_path} to define exactly one job.`);
  }

  const supported_flow = interpretSupportedFlow(
    parse_result.flow_definition,
    flow_path,
  );
  const [supported_job] = supported_flow.ordered_jobs;

  if (supported_job.kind !== 'selected-task') {
    throw new Error(
      `Expected ${flow_path} to define one supported task job object.`,
    );
  }

  return {
    await_query: supported_job.await_query,
    ordered_steps: supported_job.ordered_steps,
    select_query: supported_job.select_query,
    select_role: supported_job.select_role,
    transition_conditions: supported_job.transition_conditions,
    transition_target_bindings: supported_job.transition_target_bindings,
    transition_targets: supported_job.transition_targets,
    worktree_policy: supported_job.worktree_policy,
  };
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_path
 * @returns {{
 *   ordered_jobs: Array<
 *     | {
 *         await_query: string,
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'selected-task',
 *         needs: string[],
 *         ordered_steps: Array<
 *           | { command_text: string, kind: 'run' }
 *           | { kind: 'uses', step_name: string }
 *         >,
 *         select_query: string,
 *         select_role: string,
 *         transition_conditions: { failure: string, success: string },
 *         transition_target_bindings: { failure: string, success: string },
 *         transition_targets: { failure: string, success: string },
 *         worktree_policy:
 *           | { mode: 'ephemeral' }
 *           | { mode: 'named', slot: string },
 *       }
 *     | {
 *         if_query: string | null,
 *         job_name: string,
 *         kind: 'document-transition',
 *         needs: string[],
 *         transition_target_binding: 'document',
 *         transition_target_state: string,
 *       }
 *   >,
 * }}
 */
function interpretSupportedFlow(flow_definition, flow_path) {
  const jobs = flow_definition.jobs;

  if (!isPlainObject(jobs)) {
    throw new Error(`Expected ${flow_path} to define a jobs mapping.`);
  }

  const job_entries = Object.entries(jobs);
  const known_job_names = new Set(job_entries.map(([job_name]) => job_name));
  /** @type {Set<string>} */
  const earlier_job_names = new Set();
  /** @type {ReturnType<typeof interpretSupportedFlow>['ordered_jobs']} */
  const ordered_jobs = [];

  for (const [job_name, job_definition] of job_entries) {
    if (!isPlainObject(job_definition)) {
      throw new Error(
        `Expected ${flow_path} to define one supported job object.`,
      );
    }

    if (!Array.isArray(job_definition.steps)) {
      throw new Error(`Expected ${flow_path} to define a steps array.`);
    }

    const if_query = interpretOptionalJobIf(job_definition.if, flow_path);
    const needs = interpretNeeds(
      job_definition.needs,
      known_job_names,
      earlier_job_names,
      flow_path,
    );

    ordered_jobs.push(
      Object.hasOwn(job_definition, 'select')
        ? interpretSelectedTaskJob(
            job_name,
            job_definition,
            flow_path,
            needs,
            if_query,
          )
        : interpretDocumentTransitionJob(
            job_name,
            job_definition,
            flow_path,
            needs,
            if_query,
          ),
    );
    earlier_job_names.add(job_name);
  }

  return {
    ordered_jobs,
  };
}

/**
 * @param {string} job_name
 * @param {Record<string, unknown>} job_definition
 * @param {string} flow_path
 * @param {string[]} needs
 * @param {string | null} if_query
 * @returns {{
 *   await_query: string,
 *   if_query: string | null,
 *   job_name: string,
 *   kind: 'selected-task',
 *   needs: string[],
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string }
 *   >,
 *   select_query: string,
 *   select_role: string,
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 *   worktree_policy:
 *     | { mode: 'ephemeral' }
 *     | { mode: 'named', slot: string },
 * }}
 */
function interpretSelectedTaskJob(
  job_name,
  job_definition,
  flow_path,
  needs,
  if_query,
) {
  const select_definition = interpretSelectDefinition(
    job_definition.select,
    flow_path,
  );
  const worktree_policy = interpretWorktreePolicy(
    job_definition.worktree,
    flow_path,
  );
  const interpreted_steps = interpretTaskSteps(
    /** @type {unknown[]} */ (job_definition.steps),
    flow_path,
  );

  return {
    await_query: interpreted_steps.await_query,
    if_query,
    job_name,
    kind: 'selected-task',
    needs,
    ordered_steps: interpreted_steps.ordered_steps,
    select_query: select_definition.query_text,
    select_role: select_definition.role,
    transition_conditions: interpreted_steps.transition_conditions,
    transition_target_bindings: interpreted_steps.transition_target_bindings,
    transition_targets: interpreted_steps.transition_targets,
    worktree_policy,
  };
}

/**
 * @param {string} job_name
 * @param {Record<string, unknown>} job_definition
 * @param {string} flow_path
 * @param {string[]} needs
 * @param {string | null} if_query
 * @returns {{
 *   if_query: string | null,
 *   job_name: string,
 *   kind: 'document-transition',
 *   needs: string[],
 *   transition_target_binding: 'document',
 *   transition_target_state: string,
 * }}
 */
function interpretDocumentTransitionJob(
  job_name,
  job_definition,
  flow_path,
  needs,
  if_query,
) {
  if (Object.hasOwn(job_definition, 'worktree')) {
    throw new Error(
      `Document-transition jobs do not support worktree policies in ${flow_path}.`,
    );
  }

  const transition_step = interpretDocumentTransitionStep(
    /** @type {unknown[]} */ (job_definition.steps),
    flow_path,
  );

  return {
    if_query,
    job_name,
    kind: 'document-transition',
    needs,
    transition_target_binding: transition_step.transition_target_binding,
    transition_target_state: transition_step.transition_target_state,
  };
}

/**
 * @param {unknown} if_value
 * @param {string} flow_path
 * @returns {string | null}
 */
function interpretOptionalJobIf(if_value, flow_path) {
  if (if_value === undefined) {
    return null;
  }

  if (typeof if_value !== 'string') {
    throw new Error(`Expected ${flow_path} job.if to be a string.`);
  }

  return normalizeFlowQuery(if_value);
}

/**
 * @param {unknown} needs_value
 * @param {Set<string>} known_job_names
 * @param {Set<string>} earlier_job_names
 * @param {string} flow_path
 * @returns {string[]}
 */
function interpretNeeds(
  needs_value,
  known_job_names,
  earlier_job_names,
  flow_path,
) {
  if (needs_value === undefined) {
    return [];
  }

  if (!Array.isArray(needs_value)) {
    throw new Error(
      `Expected ${flow_path} to define needs as an array of job names.`,
    );
  }

  return needs_value.map((need_name) => {
    if (typeof need_name !== 'string' || need_name.trim() === '') {
      throw new Error(`Expected ${flow_path} needs entries to be strings.`);
    }

    if (!known_job_names.has(need_name)) {
      throw new Error(`Unknown needs target "${need_name}" in ${flow_path}.`);
    }

    if (!earlier_job_names.has(need_name)) {
      throw new Error(
        `Expected needs target "${need_name}" in ${flow_path} to reference an earlier job.`,
      );
    }

    return need_name;
  });
}

/**
 * @param {unknown[]} steps
 * @param {string} flow_path
 * @returns {{
 *   await_query: string,
 *   ordered_steps: Array<
 *     | { command_text: string, kind: 'run' }
 *     | { kind: 'uses', step_name: string }
 *   >,
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 * }}
 */
function interpretTaskSteps(steps, flow_path) {
  /** @type {Set<string>} */
  const seen_use_steps = new Set();
  /** @type {Array<
   *   | { command_text: string, kind: 'run' }
   *   | { kind: 'uses', step_name: string }
   * >} */
  const ordered_steps = [];
  /** @type {{ failure?: string, success?: string }} */
  const transition_conditions = {};
  /** @type {{ failure?: string, success?: string }} */
  const transition_target_bindings = {};
  /** @type {{ failure?: string, success?: string }} */
  const transition_targets = {};
  /** @type {string | null} */
  let await_query = null;
  /** @type {'executable' | 'transition'} */
  let step_stage = 'executable';

  for (const step of steps) {
    const step_result = interpretTaskStep(step, flow_path);

    if (step_result.kind === 'await') {
      if (step_stage !== 'executable') {
        throw new Error(
          `Expected ${flow_path} to keep executable steps before transitions.`,
        );
      }

      if (await_query !== null) {
        throw new Error(
          `Expected ${flow_path} to define exactly one await step.`,
        );
      }

      await_query = step_result.query_text;
      step_stage = 'transition';
      continue;
    }

    if (step_result.kind === 'transition') {
      if (await_query === null) {
        throw new Error(
          `Expected ${flow_path} to define an await step before transitions.`,
        );
      }

      transition_conditions[step_result.outcome] = step_result.condition_text;
      transition_target_bindings[step_result.outcome] =
        step_result.target_binding;
      transition_targets[step_result.outcome] = step_result.target_state;
      continue;
    }

    if (step_stage !== 'executable') {
      throw new Error(
        `Expected ${flow_path} to keep executable steps before await and transition steps.`,
      );
    }

    ordered_steps.push(step_result);

    if (step_result.kind === 'uses') {
      seen_use_steps.add(step_result.step_name);
    }
  }

  for (const supported_use_step of REQUIRED_TASK_USE_STEPS) {
    if (!seen_use_steps.has(supported_use_step)) {
      throw new Error(
        `Missing required uses step "${supported_use_step}" in ${flow_path}.`,
      );
    }
  }

  if (await_query === null) {
    throw new Error(`Missing required await step in ${flow_path}.`);
  }

  if (
    typeof transition_conditions.success !== 'string' ||
    typeof transition_conditions.failure !== 'string' ||
    typeof transition_target_bindings.success !== 'string' ||
    typeof transition_target_bindings.failure !== 'string' ||
    typeof transition_targets.success !== 'string' ||
    typeof transition_targets.failure !== 'string'
  ) {
    throw new Error(
      `Expected ${flow_path} to define success and failure transitions.`,
    );
  }

  return {
    await_query,
    ordered_steps,
    transition_conditions: {
      failure: transition_conditions.failure,
      success: transition_conditions.success,
    },
    transition_target_bindings: {
      failure: transition_target_bindings.failure,
      success: transition_target_bindings.success,
    },
    transition_targets: {
      failure: transition_targets.failure,
      success: transition_targets.success,
    },
  };
}

/**
 * @param {unknown[]} steps
 * @param {string} flow_path
 * @returns {{
 *   transition_target_binding: 'document',
 *   transition_target_state: string,
 * }}
 */
function interpretDocumentTransitionStep(steps, flow_path) {
  if (steps.length !== 1) {
    throw new Error(
      `Expected document-transition jobs in ${flow_path} to define exactly one step.`,
    );
  }

  const [step] = steps;

  if (!isPlainObject(step)) {
    throw new Error(`Expected ${flow_path} steps to be objects.`);
  }

  if (Object.hasOwn(step, 'worktree')) {
    throw new Error(
      `Step-level worktree overrides are not supported in ${flow_path}.`,
    );
  }

  if (Object.hasOwn(step, 'await') || Object.hasOwn(step, 'run')) {
    throw new Error(`Unsupported reconciler step shape in ${flow_path}.`);
  }

  if (Object.hasOwn(step, 'if')) {
    throw new Error(
      `Document-transition steps do not support step-level if conditions in ${flow_path}.`,
    );
  }

  if (typeof step.uses === 'string') {
    if (!SUPPORTED_TRANSITION_USE_STEPS.has(step.uses)) {
      throw new Error(`Unsupported uses step "${step.uses}" in ${flow_path}.`);
    }
  } else if (Object.hasOwn(step, 'uses')) {
    throw new Error(`Unsupported reconciler step shape in ${flow_path}.`);
  }

  if (!isPlainObject(step.transition)) {
    throw new Error(`Unsupported reconciler step shape in ${flow_path}.`);
  }

  const transition_target = interpretTransitionTarget(
    step.transition,
    flow_path,
  );

  if (transition_target.target_binding !== 'document') {
    throw new Error(
      `Document-transition jobs must target "document" in ${flow_path}.`,
    );
  }

  return {
    transition_target_binding: 'document',
    transition_target_state: transition_target.target_state,
  };
}

/**
 * @param {unknown} step
 * @param {string} flow_path
 * @returns {{
 *   kind: 'await',
 *   query_text: string,
 * } | {
 *   kind: 'transition',
 *   condition_text: string,
 *   outcome: 'failure' | 'success',
 *   target_binding: string,
 *   target_state: string,
 * } | {
 *   command_text: string,
 *   kind: 'run',
 * } | {
 *   kind: 'uses',
 *   step_name: string,
 * }}
 */
function interpretTaskStep(step, flow_path) {
  if (!isPlainObject(step)) {
    throw new Error(`Expected ${flow_path} steps to be objects.`);
  }

  if (Object.hasOwn(step, 'worktree')) {
    throw new Error(
      `Step-level worktree overrides are not supported in ${flow_path}.`,
    );
  }

  if (typeof step.run === 'string') {
    return {
      command_text: step.run,
      kind: 'run',
    };
  }

  if (Object.hasOwn(step, 'run')) {
    throw new Error(`Expected run to be a string in ${flow_path}.`);
  }

  if (typeof step.uses === 'string') {
    if (!SUPPORTED_TASK_USE_STEPS.has(step.uses)) {
      throw new Error(`Unsupported uses step "${step.uses}" in ${flow_path}.`);
    }

    return {
      kind: 'uses',
      step_name: step.uses,
    };
  }

  if (Object.hasOwn(step, 'await')) {
    if (typeof step.await !== 'string') {
      throw new Error(`Expected await to be a string in ${flow_path}.`);
    }

    return {
      kind: 'await',
      query_text: normalizeFlowQuery(step.await),
    };
  }

  if (typeof step.if === 'string' && isPlainObject(step.transition)) {
    const transition_target = interpretTransitionTarget(
      step.transition,
      flow_path,
    );

    return {
      condition_text: normalizeFlowQuery(step.if),
      kind: 'transition',
      outcome: resolveTransitionOutcome(step.if, flow_path),
      target_binding: transition_target.target_binding,
      target_state: transition_target.target_state,
    };
  }

  throw new Error(`Unsupported reconciler step shape in ${flow_path}.`);
}

/**
 * @param {unknown} worktree_definition
 * @param {string} flow_path
 * @returns {{ mode: 'ephemeral' } | { mode: 'named', slot: string }}
 */
function interpretWorktreePolicy(worktree_definition, flow_path) {
  if (!isPlainObject(worktree_definition)) {
    throw new Error(
      `Expected ${flow_path} to define a supported job-level worktree policy.`,
    );
  }

  if (worktree_definition.mode === 'ephemeral') {
    if (Object.hasOwn(worktree_definition, 'slot')) {
      throw new Error(
        `Ephemeral worktree policy must not define a slot in ${flow_path}.`,
      );
    }

    return {
      mode: 'ephemeral',
    };
  }

  if (worktree_definition.mode === 'named') {
    if (
      typeof worktree_definition.slot !== 'string' ||
      worktree_definition.slot.trim() === ''
    ) {
      throw new Error(
        `Named worktree policy must define a non-empty slot in ${flow_path}.`,
      );
    }

    return {
      mode: 'named',
      slot: worktree_definition.slot,
    };
  }

  throw new Error(
    `Unsupported worktree mode "${String(worktree_definition.mode)}" in ${flow_path}.`,
  );
}

/**
 * @param {string} condition_text
 * @param {string} flow_path
 * @returns {'failure' | 'success'}
 */
function resolveTransitionOutcome(condition_text, flow_path) {
  const normalized_condition = normalizeFlowQuery(condition_text);

  if (normalized_condition.includes('outcome = success')) {
    return 'success';
  }

  if (normalized_condition.includes('outcome = failure')) {
    return 'failure';
  }

  throw new Error(
    `Unsupported transition condition in ${flow_path}: ${condition_text}`,
  );
}

/**
 * @param {unknown} select_value
 * @param {string} flow_path
 * @returns {{ query_text: string, role: string }}
 */
function interpretSelectDefinition(select_value, flow_path) {
  if (isPlainObject(select_value) && typeof select_value.role === 'string') {
    if (select_value.role !== 'task') {
      throw new Error(
        `Unsupported select role "${select_value.role}" in ${flow_path}.`,
      );
    }

    return {
      query_text: '$class == task and tracked_in == @document',
      role: 'task',
    };
  }

  if (typeof select_value === 'string' && usesQuerySyntax(select_value)) {
    return {
      query_text: normalizeFlowQuery(select_value),
      role: resolveSelectQueryRole(select_value, new Set(['task'])),
    };
  }

  throw new Error(
    `Expected ${flow_path} to define a supported select query or select.role value.`,
  );
}

/**
 * @param {Record<string, unknown>} transition_value
 * @param {string} flow_path
 * @returns {{ target_binding: string, target_state: string }}
 */
function interpretTransitionTarget(transition_value, flow_path) {
  if (typeof transition_value.to === 'string') {
    return {
      target_binding: 'task',
      target_state: transition_value.to,
    };
  }

  const target_binding =
    typeof transition_value.target === 'string'
      ? transition_value.target
      : 'task';

  if (!SUPPORTED_TRANSITION_TARGETS.has(target_binding)) {
    throw new Error(
      `Unsupported transition target "${target_binding}" in ${flow_path}.`,
    );
  }

  if (typeof transition_value.status !== 'string') {
    throw new Error(
      `Expected transition.status to be a string in ${flow_path}.`,
    );
  }

  return {
    target_binding,
    target_state: transition_value.status,
  };
}

/**
 * @param {Array<{ file_path: string, message: string }>} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
    .join('\n');
}
