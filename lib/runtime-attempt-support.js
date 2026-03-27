/** @import { BuildGraphResult, QueryGraphApi } from './patram-types.ts' */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createMixedRuntimeGraph,
  evaluateMixedGraphQuery,
} from './mixed-graph-runtime.js';
import { updateDocumentStatus } from './runtime-files.js';

export { createRuntimePrompt, projectTaskOutcome };

/**
 * @param {string} repo_directory
 * @param {{
 *   contract_path: string,
 *   decision_paths: string[],
 *   flow_path: string,
 *   runtime_label: string,
 *   task_path: string,
 * }} options
 * @returns {Promise<string>}
 */
async function createRuntimePrompt(repo_directory, options) {
  const prompt_sections = [
    `You are executing the ${options.runtime_label}.`,
    'Operate only in the provided working directory.',
    'Do not edit repository files in this slice.',
    'Return JSON with a single "summary" string.',
    '',
  ];

  for (const prompt_document of createPromptDocuments(options)) {
    const document_text = await readFile(
      join(repo_directory, prompt_document.path),
      'utf8',
    );

    prompt_sections.push(
      `${prompt_document.label} (${prompt_document.path}):`,
      document_text.trimEnd(),
      '',
    );
  }

  return prompt_sections.join('\n');
}

/**
 * @param {string} repo_directory
 * @param {{
 *   await_query: string,
 *   binding_targets: Record<
 *     string,
 *     { id: string, path: string, status: string } | undefined
 *   >,
 *   durable_graph: BuildGraphResult,
 *   flow_id: string,
 *   graph_api: QueryGraphApi,
 *   relation_names: string[],
 *   runtime_records: Record<string, unknown>[],
 *   transition_conditions: { failure: string, success: string },
 *   transition_target_bindings: { failure: string, success: string },
 *   transition_targets: { failure: string, success: string },
 * }} options
 * @returns {Promise<void>}
 */
async function projectTaskOutcome(repo_directory, options) {
  const relation_bindings = createRelationBindings(options.binding_targets);
  const mixed_graph = createMixedRuntimeGraph(options.durable_graph, {
    binding_targets: options.binding_targets,
    flow_id: options.flow_id,
    include_terminal_runtime_signals: true,
    runtime_records: options.runtime_records,
  });

  if (
    !evaluateMixedGraphQuery(
      mixed_graph,
      options.graph_api,
      options.await_query,
      relation_bindings,
      options.relation_names,
    )
  ) {
    throw new Error('Await query did not match the mixed runtime graph.');
  }

  const matching_outcomes = resolveMatchingTransitionOutcomes(
    mixed_graph,
    options,
    relation_bindings,
  );

  if (matching_outcomes.length !== 1) {
    throw new Error(
      'Expected exactly one transition condition to match the mixed runtime graph.',
    );
  }

  const [matched_outcome] = matching_outcomes;
  const target_binding = readBindingName(
    options.transition_target_bindings,
    matched_outcome,
  );
  const target_document = readBoundDocument(
    options.binding_targets,
    target_binding,
  );

  await updateDocumentStatus(
    join(repo_directory, target_document.path),
    target_document.status,
    readTransitionState(options.transition_targets, matched_outcome),
  );
}

/**
 * @param {{
 *   contract_path: string,
 *   decision_paths: string[],
 *   flow_path: string,
 *   task_path: string,
 * }} options
 * @returns {Array<{ label: string, path: string }>}
 */
function createPromptDocuments(options) {
  return [
    {
      label: 'Contract document',
      path: options.contract_path,
    },
    ...options.decision_paths.map((decision_path) => ({
      label: 'Decision document',
      path: decision_path,
    })),
    {
      label: 'Root flow document',
      path: options.flow_path,
    },
    {
      label: 'Task document',
      path: options.task_path,
    },
  ];
}

/**
 * @param {{
 *   [binding_name: string]:
 *     | { id: string, path: string, status: string }
 *     | undefined,
 * }} binding_targets
 * @returns {Record<string, string>}
 */
function createRelationBindings(binding_targets) {
  /** @type {Record<string, string>} */
  const relation_bindings = {};

  for (const [binding_name, binding_target] of Object.entries(
    binding_targets,
  )) {
    if (binding_target === undefined) {
      continue;
    }

    relation_bindings[binding_name] = binding_target.id;
  }

  return relation_bindings;
}

/**
 * @param {BuildGraphResult} mixed_graph
 * @param {{
 *   graph_api: QueryGraphApi,
 *   relation_names: string[],
 *   transition_conditions: { failure: string, success: string },
 * }} options
 * @param {Record<string, string>} relation_bindings
 * @returns {Array<'failure' | 'success'>}
 */
function resolveMatchingTransitionOutcomes(
  mixed_graph,
  options,
  relation_bindings,
) {
  /** @type {Array<'failure' | 'success'>} */
  const outcomes = ['failure', 'success'];

  return /** @type {Array<'failure' | 'success'>} */ (
    outcomes.filter((outcome) =>
      evaluateMixedGraphQuery(
        mixed_graph,
        options.graph_api,
        readTransitionState(options.transition_conditions, outcome),
        relation_bindings,
        options.relation_names,
      ),
    )
  );
}

/**
 * @param {{ failure: string, success: string }} transition_bindings
 * @param {'failure' | 'success'} outcome
 * @returns {string}
 */
function readBindingName(transition_bindings, outcome) {
  const binding_name = transition_bindings[outcome];

  if (typeof binding_name !== 'string' || binding_name.trim() === '') {
    throw new Error(`Unsupported transition binding "${binding_name}".`);
  }

  return binding_name;
}

/**
 * @param {{
 *   [binding_name: string]:
 *     | { id: string, path: string, status: string }
 *     | undefined,
 * }} binding_targets
 * @param {string} binding_name
 * @returns {{ id: string, path: string, status: string }}
 */
function readBoundDocument(binding_targets, binding_name) {
  const target_document = binding_targets[binding_name];

  if (target_document === undefined) {
    throw new Error(`Missing bound transition target "${binding_name}".`);
  }

  return target_document;
}

/**
 * @param {{ failure: string, success: string }} transition_targets
 * @param {'failure' | 'success'} outcome
 * @returns {string}
 */
function readTransitionState(transition_targets, outcome) {
  return transition_targets[outcome];
}
