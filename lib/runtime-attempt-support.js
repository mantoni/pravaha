import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export { createRuntimePrompt };

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
