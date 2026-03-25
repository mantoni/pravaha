import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFlowDefinition } from './load-flow-definition.js';
import { isPlainObject } from './validation-helpers.js';

const SUPPORTED_USE_STEPS = new Set([
  'core/lease-task',
  'core/setup-worktree',
  'core/codex-sdk',
]);

export { loadSupportedJob };

/**
 * @param {string} repo_directory
 * @param {string} flow_path
 * @returns {Promise<{
 *   select_role: string,
 *   transition_targets: { failure: string, success: string },
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

  return interpretSupportedJob(parse_result.flow_definition, flow_path);
}

/**
 * @param {Record<string, unknown>} flow_definition
 * @param {string} flow_path
 * @returns {{
 *   select_role: string,
 *   transition_targets: { failure: string, success: string },
 * }}
 */
function interpretSupportedJob(flow_definition, flow_path) {
  const jobs = flow_definition.jobs;

  if (!isPlainObject(jobs)) {
    throw new Error(`Expected ${flow_path} to define a jobs mapping.`);
  }

  const job_entries = Object.entries(jobs);

  if (job_entries.length !== 1) {
    throw new Error(`Expected ${flow_path} to define exactly one job.`);
  }

  const [, job_definition] = job_entries[0];

  if (!isPlainObject(job_definition) || !isPlainObject(job_definition.select)) {
    throw new Error(
      `Expected ${flow_path} to define a single select.role value.`,
    );
  }

  if (typeof job_definition.select.role !== 'string') {
    throw new Error(
      `Expected ${flow_path} to use the supported select.role shape.`,
    );
  }

  if (!Array.isArray(job_definition.steps)) {
    throw new Error(`Expected ${flow_path} to define a steps array.`);
  }

  return {
    select_role: job_definition.select.role,
    transition_targets: interpretSupportedSteps(
      job_definition.steps,
      flow_path,
    ),
  };
}

/**
 * @param {unknown[]} steps
 * @param {string} flow_path
 * @returns {{ failure: string, success: string }}
 */
function interpretSupportedSteps(steps, flow_path) {
  /** @type {Set<string>} */
  const seen_use_steps = new Set();
  /** @type {{ failure?: string, success?: string }} */
  const transition_targets = {};
  let saw_await_step = false;

  for (const step of steps) {
    const step_result = interpretStep(step, flow_path);

    if (step_result.kind === 'await') {
      saw_await_step = true;
      continue;
    }

    if (step_result.kind === 'transition') {
      transition_targets[step_result.outcome] = step_result.target_state;
      continue;
    }

    seen_use_steps.add(step_result.step_name);
  }

  for (const supported_use_step of SUPPORTED_USE_STEPS) {
    if (!seen_use_steps.has(supported_use_step)) {
      throw new Error(
        `Missing required uses step "${supported_use_step}" in ${flow_path}.`,
      );
    }
  }

  if (!saw_await_step) {
    throw new Error(`Missing required await step in ${flow_path}.`);
  }

  if (
    typeof transition_targets.success !== 'string' ||
    typeof transition_targets.failure !== 'string'
  ) {
    throw new Error(
      `Expected ${flow_path} to define success and failure transitions.`,
    );
  }

  return {
    failure: transition_targets.failure,
    success: transition_targets.success,
  };
}

/**
 * @param {unknown} step
 * @param {string} flow_path
 * @returns {{
 *   kind: 'await',
 * } | {
 *   kind: 'transition',
 *   outcome: 'failure' | 'success',
 *   target_state: string,
 * } | {
 *   kind: 'uses',
 *   step_name: string,
 * }}
 */
function interpretStep(step, flow_path) {
  if (!isPlainObject(step)) {
    throw new Error(`Expected ${flow_path} steps to be objects.`);
  }

  if (typeof step.uses === 'string') {
    if (!SUPPORTED_USE_STEPS.has(step.uses)) {
      throw new Error(`Unsupported uses step "${step.uses}" in ${flow_path}.`);
    }

    return {
      kind: 'uses',
      step_name: step.uses,
    };
  }

  if (Object.hasOwn(step, 'await')) {
    return { kind: 'await' };
  }

  if (typeof step.if === 'string' && isPlainObject(step.transition)) {
    if (typeof step.transition.to !== 'string') {
      throw new Error(`Expected transition.to to be a string in ${flow_path}.`);
    }

    return {
      kind: 'transition',
      outcome: resolveTransitionOutcome(step.if, flow_path),
      target_state: step.transition.to,
    };
  }

  throw new Error(`Unsupported reconciler step shape in ${flow_path}.`);
}

/**
 * @param {string} condition_text
 * @param {string} flow_path
 * @returns {'failure' | 'success'}
 */
function resolveTransitionOutcome(condition_text, flow_path) {
  const normalized_condition = condition_text.replaceAll(/\s+/gu, ' ').trim();

  if (normalized_condition.includes('outcome == success')) {
    return 'success';
  }

  if (normalized_condition.includes('outcome == failure')) {
    return 'failure';
  }

  throw new Error(
    `Unsupported transition condition in ${flow_path}: ${condition_text}`,
  );
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
