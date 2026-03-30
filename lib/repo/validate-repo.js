/** @import { ValidationDiagnostic, ValidationResult } from '../shared/types/validation.types.ts' */
/* eslint-disable max-lines-per-function */

import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { normalizePravahaConfig } from '../config/load-pravaha-config.js';
import { loadStateMachineFlow } from '../flow/reconcile-flow.js';
import { validateFlowDocument } from '../flow/validate-flow-document.js';
import {
  createDiagnostic,
  listYamlFiles,
  readJsonFile,
} from '../shared/diagnostics/validation-helpers.js';
import { createPatramModel } from './semantics/create-patram-model.js';

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
  const flow_directory_path = join(repo_directory, FLOWS_DIRECTORY);
  const patram_config_result = await readJsonFile(patram_config_path);
  const pravaha_config_result = await readJsonFile(
    join(repo_directory, PRAVAHA_CONFIG_FILENAME),
  );
  diagnostics.push(...pravaha_config_result.diagnostics);
  /** @type {ValidationDiagnostic[]} */
  const workspace_config_diagnostics = [];
  const pravaha_config = normalizePravahaConfig(
    pravaha_config_result.value,
    join(repo_directory, PRAVAHA_CONFIG_FILENAME),
    workspace_config_diagnostics,
  );
  diagnostics.push(
    ...workspace_config_diagnostics.filter((diagnostic) =>
      diagnostic.message.startsWith('Pravaha config workspaces'),
    ),
  );
  const patram_model = createPatramModel(
    patram_config_result,
    patram_config_path,
    diagnostics,
  );
  const flow_file_paths = await listYamlFiles(flow_directory_path, diagnostics);
  /** @type {Array<{
   *   flow_path: string,
   *   workspace: Awaited<ReturnType<typeof loadStateMachineFlow>>['workspace'],
   * }>}
   */
  const workspace_flows = [];

  for (const flow_file_path of flow_file_paths) {
    const flow_document_text = await readFile(flow_file_path, 'utf8');
    const flow_diagnostics = await validateFlowDocument(
      flow_document_text,
      flow_file_path,
      patram_model,
      {
        repo_directory,
      },
    );

    diagnostics.push(...flow_diagnostics);

    if (flow_diagnostics.length > 0) {
      continue;
    }

    const flow_path = relative(repo_directory, flow_file_path);
    const state_machine_flow = await loadStateMachineFlow(
      repo_directory,
      flow_path,
    );

    workspace_flows.push({
      flow_path,
      workspace: state_machine_flow.workspace,
    });
  }

  diagnostics.push(
    ...collectWorkspaceFlowDiagnostics(
      workspace_flows,
      pravaha_config.workspace_config,
      repo_directory,
    ),
  );

  return {
    checked_flow_count: flow_file_paths.length,
    diagnostics,
  };
}

/**
 * @param {Array<{
 *   flow_path: string,
 *   workspace: Awaited<ReturnType<typeof loadStateMachineFlow>>['workspace'],
 * }>} workspace_flows
 * @param {ReturnType<typeof normalizePravahaConfig>['workspace_config']} workspace_config
 * @param {string} repo_directory
 * @returns {ValidationDiagnostic[]}
 */
function collectWorkspaceFlowDiagnostics(
  workspace_flows,
  workspace_config,
  repo_directory,
) {
  /** @type {ValidationDiagnostic[]} */
  const diagnostics = [];

  for (const workspace_flow of workspace_flows) {
    if (workspace_config[workspace_flow.workspace.id] === undefined) {
      diagnostics.push(
        createDiagnostic(
          join(repo_directory, workspace_flow.flow_path),
          `Flow workspace.id "${workspace_flow.workspace.id}" is not defined in pravaha.json workspaces.`,
        ),
      );
    }
  }

  return diagnostics;
}
