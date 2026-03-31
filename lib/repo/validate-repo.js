/** @import { ValidationDiagnostic, ValidationResult } from '../shared/types/validation.types.ts' */
/* eslint-disable max-lines-per-function */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { normalizePravahaConfig } from '../config/load-pravaha-config.js';
import { loadExecutableDispatchFlow } from '../flow/load-executable-dispatch-flow.js';
import { validateFlowDocument } from '../flow/validate-flow-document.js';
import {
  compareText,
  createDiagnostic,
  listFlowFiles,
  readJsonFile,
} from '../shared/diagnostics/validation-helpers.js';
import { createPatramModel } from './semantics/create-patram-model.js';

const DEFAULT_FLOWS_DIRECTORY = 'docs/flows';
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
  const flow_file_paths = await collectConfiguredFlowFiles(
    repo_directory,
    pravaha_config,
    diagnostics,
  );
  /** @type {Array<{
   *   flow_path: string,
   *   workspace: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>['flow']['workspace'],
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
    const dispatch_flow = await loadExecutableDispatchFlow(
      repo_directory,
      flow_path,
    );

    workspace_flows.push({
      flow_path,
      workspace: dispatch_flow.flow.workspace,
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
 *   workspace: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>['flow']['workspace'],
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

/**
 * @param {string} repo_directory
 * @param {ReturnType<typeof normalizePravahaConfig>} pravaha_config
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Promise<string[]>}
 */
async function collectConfiguredFlowFiles(
  repo_directory,
  pravaha_config,
  diagnostics,
) {
  const flow_directory_paths = resolveFlowValidationDirectories(pravaha_config);
  /** @type {Set<string>} */
  const flow_file_path_set = new Set();

  for (const flow_directory_path of flow_directory_paths) {
    const absolute_directory_path = join(repo_directory, flow_directory_path);
    const flow_file_paths = await listFlowFiles(
      absolute_directory_path,
      diagnostics,
    );

    for (const flow_file_path of flow_file_paths) {
      flow_file_path_set.add(flow_file_path);
    }
  }

  return [...flow_file_path_set].sort(compareText);
}

/**
 * @param {ReturnType<typeof normalizePravahaConfig>} pravaha_config
 * @returns {string[]}
 */
function resolveFlowValidationDirectories(pravaha_config) {
  /** @type {string[]} */
  const flow_references = [...pravaha_config.flow_config.default_matches];

  if (pravaha_config.queue_config.validation_flow !== null) {
    flow_references.push(pravaha_config.queue_config.validation_flow);
  }

  if (flow_references.length === 0) {
    return [DEFAULT_FLOWS_DIRECTORY];
  }

  /** @type {string[]} */
  const flow_directory_paths = [];

  for (const flow_reference of flow_references) {
    flow_directory_paths.push(resolveFlowValidationDirectory(flow_reference));
  }

  return minimizeDirectoryPaths(flow_directory_paths);
}

/**
 * @param {string} flow_reference
 * @returns {string}
 */
function resolveFlowValidationDirectory(flow_reference) {
  const static_prefix = readStaticPathPrefix(flow_reference);
  const normalized_static_prefix = static_prefix.endsWith('/')
    ? static_prefix.slice(0, -1)
    : static_prefix;

  if (normalized_static_prefix === '') {
    return '.';
  }

  if (static_prefix === flow_reference) {
    return dirname(flow_reference);
  }

  return normalized_static_prefix;
}

/**
 * @param {string[]} directory_paths
 * @returns {string[]}
 */
function minimizeDirectoryPaths(directory_paths) {
  const unique_directory_paths = [...new Set(directory_paths)].sort(
    (left_path, right_path) =>
      compareText(
        `${left_path.split('/').length}:${left_path}`,
        `${right_path.split('/').length}:${right_path}`,
      ),
  );
  /** @type {string[]} */
  const minimized_directory_paths = [];

  for (const directory_path of unique_directory_paths) {
    if (
      minimized_directory_paths.some((parent_directory_path) =>
        isSameOrChildPath(parent_directory_path, directory_path),
      )
    ) {
      continue;
    }

    minimized_directory_paths.push(directory_path);
  }

  return minimized_directory_paths.sort(compareText);
}

/**
 * @param {string} parent_directory_path
 * @param {string} directory_path
 * @returns {boolean}
 */
function isSameOrChildPath(parent_directory_path, directory_path) {
  if (parent_directory_path === '.') {
    return true;
  }

  const relative_path = relative(parent_directory_path, directory_path);

  return (
    relative_path === '' ||
    (!relative_path.startsWith('..') && !isAbsolute(relative_path))
  );
}

/**
 * @param {string} flow_reference
 * @returns {string}
 */
function readStaticPathPrefix(flow_reference) {
  let static_prefix = '';

  for (const character of flow_reference) {
    if ('*?[]{}()!+'.includes(character)) {
      break;
    }

    static_prefix += character;
  }

  return static_prefix;
}
