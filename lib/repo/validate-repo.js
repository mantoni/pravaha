/** @import { ValidationDiagnostic, ValidationResult } from '../validation.types.ts' */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateFlowDocument } from '../flow/validate-flow-document.js';
import { listYamlFiles, readJsonFile } from '../validation-helpers.js';
import { createSemanticModel } from './semantics/create-semantic-model.js';

const FLOWS_DIRECTORY = 'docs/flows';
const PATRAM_CONFIG_FILENAME = '.patram.json';
const PRAVAHA_CONFIG_FILENAME = 'pravaha.json';

export { validateRepo };

/**
 * @param {string} repo_directory
 * @returns {Promise<ValidationResult>}
 */
async function validateRepo(repo_directory) {
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];
  const patram_config_path = join(repo_directory, PATRAM_CONFIG_FILENAME);
  const pravaha_config_path = join(repo_directory, PRAVAHA_CONFIG_FILENAME);
  const flow_directory_path = join(repo_directory, FLOWS_DIRECTORY);
  const patram_config_result = await readJsonFile(patram_config_path);
  const pravaha_config_result = await readJsonFile(pravaha_config_path);
  const semantic_model = createSemanticModel(
    patram_config_result,
    pravaha_config_result,
    pravaha_config_path,
    diagnostics,
  );
  const flow_file_paths = await listYamlFiles(flow_directory_path, diagnostics);

  for (const flow_file_path of flow_file_paths) {
    const flow_document_text = await readFile(flow_file_path, 'utf8');

    diagnostics.push(
      ...(await validateFlowDocument(
        flow_document_text,
        flow_file_path,
        semantic_model,
        {
          repo_directory,
        },
      )),
    );
  }

  return {
    checked_flow_count: flow_file_paths.length,
    diagnostics,
  };
}
