/** @import { Usage } from '@openai/codex-sdk' */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { updateDocumentStatus } from './runtime-files.js';

export { createRuntimePrompt, createRuntimeRecord, projectTaskOutcome };

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
 * @param {{
 *   completed_at?: string,
 *   contract_path: string,
 *   flow_path: string,
 *   leased_at: string,
 *   outcome: 'failure' | 'success' | null,
 *   prompt: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_item_count: number,
 *   worker_thread_id: string | null,
 *   worker_usage: Usage | null,
 *   worktree_path: string,
 * }} options
 */
function createRuntimeRecord(options) {
  /** @type {{
   *   completed_at?: string,
   *   contract_path: string,
   *   flow_path: string,
   *   leased_at: string,
   *   outcome: 'failure' | 'success' | null,
   *   prompt: string,
   *   task_id: string,
   *   task_path: string,
   *   worker: {
   *     error_message: string | null,
   *     final_response: string | null,
   *     item_count: number,
   *     thread_id: string | null,
   *     usage: Usage | null,
   *   },
   *   worktree_path: string,
   * }} */
  const runtime_record = {
    contract_path: options.contract_path,
    flow_path: options.flow_path,
    leased_at: options.leased_at,
    outcome: options.outcome,
    prompt: options.prompt,
    task_id: options.task_id,
    task_path: options.task_path,
    worker: {
      error_message: options.worker_error,
      final_response: options.worker_final_response,
      item_count: options.worker_item_count,
      thread_id: options.worker_thread_id,
      usage: options.worker_usage,
    },
    worktree_path: options.worktree_path,
  };

  if (options.completed_at !== undefined) {
    runtime_record.completed_at = options.completed_at;
  }

  return runtime_record;
}

/**
 * @param {string} repo_directory
 * @param {{
 *   outcome: 'failure' | 'success',
 *   task_path: string,
 *   transition_targets: { failure: string, success: string },
 * }} options
 * @returns {Promise<void>}
 */
async function projectTaskOutcome(repo_directory, options) {
  const next_status =
    options.outcome === 'success'
      ? options.transition_targets.success
      : options.transition_targets.failure;

  await updateDocumentStatus(
    join(repo_directory, options.task_path),
    'ready',
    next_status,
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
