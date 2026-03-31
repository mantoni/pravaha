/* eslint-disable max-lines, max-lines-per-function */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadPravahaConfig } from '../config/load-pravaha-config.js';
import { loadExecutableDispatchFlow } from '../flow/load-executable-dispatch-flow.js';
import { dispatchAssignmentAndWait } from '../runtime/dispatch/session.js';
import {
  createEphemeralWorkspacePath,
  createConcreteWorkspaceDefinition,
  RUNTIME_DIRECTORY,
  resolveConfiguredWorkspacePaths,
} from '../runtime/workspaces/runtime-files.js';
import { execGitFile } from '../shared/git/exec-git-file.js';

export { loadQueueValidationFlow, validateQueueCandidate };

const QUEUE_VALIDATION_CONTRACT_PATH = join(
  RUNTIME_DIRECTORY,
  'queue-validation',
  'contract.md',
);
const QUEUE_VALIDATION_REF = 'refs/pravaha/queue-validation/current';

/**
 * @param {string} repo_directory
 * @param {string | null} validation_flow_path
 * @returns {Promise<{
 *   flow: {
 *     handlers: Record<string, Function>,
 *     trigger: {
 *       owner_class: string,
 *       query_text: string,
 *     },
 *     workspace: string,
 *   },
 *   flow_path: string,
 *   workspace_config: Awaited<ReturnType<typeof loadPravahaConfig>>['config']['workspace_config'],
 * } | null>}
 */
async function loadQueueValidationFlow(repo_directory, validation_flow_path) {
  if (validation_flow_path === null) {
    return null;
  }

  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(
      pravaha_config_result.diagnostics
        .map((diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`)
        .join('\n'),
    );
  }

  const dispatch_flow = await loadExecutableDispatchFlow(
    repo_directory,
    validation_flow_path,
  );

  const javascript_flow = /** @type {{
   *   handlers: Record<string, Function>,
   *   trigger: {
   *     owner_class: string,
   *     query_text: string,
   *   },
   *   workspace: string,
   * }} */ (dispatch_flow.flow);

  return {
    flow: javascript_flow,
    flow_path: validation_flow_path,
    workspace_config: pravaha_config_result.config.workspace_config,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} temp_directory
 * @param {string} ready_ref
 * @param {{
 *   flow: {
 *     handlers: Record<string, Function>,
 *     trigger: {
 *       owner_class: string,
 *       query_text: string,
 *     },
 *     workspace: string,
 *   },
 *   flow_path: string,
 *   workspace_config: Awaited<ReturnType<typeof loadPravahaConfig>>['config']['workspace_config'],
 * } | null} validation_flow
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @returns {Promise<'failure' | 'success'>}
 */
async function validateQueueCandidate(
  repo_directory,
  temp_directory,
  ready_ref,
  validation_flow,
  operator_io,
) {
  if (validation_flow === null) {
    return 'success';
  }

  const validation_token = createQueueValidationToken(ready_ref);
  const task_id = `queue-validation-${validation_token}`;
  const task_path = join(
    RUNTIME_DIRECTORY,
    'queue-validation',
    `${task_id}.md`,
  );
  const contract_absolute_path = join(
    repo_directory,
    QUEUE_VALIDATION_CONTRACT_PATH,
  );
  const task_absolute_path = join(repo_directory, task_path);
  const runtime_record_path = join(
    repo_directory,
    RUNTIME_DIRECTORY,
    `${task_id}.json`,
  );

  await mkdir(join(repo_directory, RUNTIME_DIRECTORY, 'queue-validation'), {
    recursive: true,
  });

  try {
    await writeQueueValidationDocuments(
      contract_absolute_path,
      task_absolute_path,
      ready_ref,
      validation_flow.flow_path,
    );
    await fetchValidationCandidateRef(
      repo_directory,
      temp_directory,
      QUEUE_VALIDATION_REF,
    );

    const dispatch_result = await dispatchAssignmentAndWait(
      repo_directory,
      {
        assignment_id: task_id,
        binding_targets: {
          doc: {
            id: `task:${task_id}`,
            path: task_path,
            status: 'ready',
          },
        },
        contract_path: QUEUE_VALIDATION_CONTRACT_PATH,
        decision_paths: [],
        flow_instance_id: task_id,
        flow_path: validation_flow.flow_path,
        task_id,
        task_path,
        type: 'assignment',
        workspace: createQueueValidationWorkspace(
          repo_directory,
          task_id,
          validation_flow.flow.workspace,
          validation_flow.workspace_config,
        ),
      },
      {
        operator_io,
        source: 'queue-sync',
      },
    );

    return dispatch_result.outcome === 'success' ? 'success' : 'failure';
  } finally {
    await cleanupQueueValidationArtifacts(repo_directory, runtime_record_path, [
      contract_absolute_path,
      task_absolute_path,
    ]);
  }
}

/**
 * @param {string} repo_directory
 * @param {string} temp_directory
 * @param {string} target_ref
 * @returns {Promise<void>}
 */
async function fetchValidationCandidateRef(
  repo_directory,
  temp_directory,
  target_ref,
) {
  await execGitFile(['fetch', temp_directory, `+HEAD:${target_ref}`], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} ready_ref
 * @returns {string}
 */
function createQueueValidationToken(ready_ref) {
  return ready_ref
    .replace(/^refs\/queue\/ready\//u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

/**
 * @param {string} repo_directory
 * @param {string} flow_instance_id
 * @param {string} workspace_id
 * @param {Awaited<ReturnType<typeof loadPravahaConfig>>['config']['workspace_config']} workspace_config
 * @returns {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral' | 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }}
 */
function createQueueValidationWorkspace(
  repo_directory,
  flow_instance_id,
  workspace_id,
  workspace_config,
) {
  if (typeof workspace_id !== 'string' || workspace_id.trim() === '') {
    throw new Error(
      'Expected queue validation workspace to be a non-empty string.',
    );
  }

  const [workspace_path] = resolveConfiguredWorkspacePaths(
    repo_directory,
    workspace_id,
    workspace_config,
  );

  const configured_workspace = workspace_config[workspace_id];

  if (configured_workspace === undefined) {
    throw new Error(
      `Flow workspace "${workspace_id}" is not defined in pravaha.json workspaces.`,
    );
  }

  if (configured_workspace.mode === 'pooled') {
    if (typeof workspace_path !== 'string') {
      throw new Error(
        `Expected pooled workspace "${workspace_id}" to define at least one path.`,
      );
    }

    return createConcreteWorkspaceDefinition(
      workspace_id,
      configured_workspace,
      workspace_path,
    );
  }

  return createConcreteWorkspaceDefinition(
    workspace_id,
    configured_workspace,
    createEphemeralWorkspacePath(
      repo_directory,
      workspace_id,
      workspace_config,
      flow_instance_id,
    ),
  );
}

/**
 * @param {string} contract_path
 * @param {string} task_path
 * @param {string} ready_ref
 * @param {string} validation_flow_path
 * @returns {Promise<void>}
 */
async function writeQueueValidationDocuments(
  contract_path,
  task_path,
  ready_ref,
  validation_flow_path,
) {
  await writeFile(
    contract_path,
    [
      '# Queue Validation Contract',
      '',
      `Validation flow: ${validation_flow_path}`,
      '',
      'This contract exists only to support internal queue candidate validation.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    task_path,
    [
      '# Queue Validation Task',
      '',
      `Ready ref: ${ready_ref}`,
      '',
      'Validate the current queue candidate without publishing or pruning on success.',
      '',
    ].join('\n'),
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @param {string} runtime_record_path
 * @param {string[]} document_paths
 * @returns {Promise<void>}
 */
async function cleanupQueueValidationArtifacts(
  repo_directory,
  runtime_record_path,
  document_paths,
) {
  await deleteLocalRef(repo_directory, QUEUE_VALIDATION_REF);

  for (const document_path of document_paths) {
    await rm(document_path, { force: true });
  }

  if (runtime_record_path !== '') {
    await rm(runtime_record_path, { force: true });
  }
}

/**
 * @param {string} repo_directory
 * @param {string} ref_name
 * @returns {Promise<void>}
 */
async function deleteLocalRef(repo_directory, ref_name) {
  try {
    await execGitFile(['update-ref', '-d', ref_name], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
  } catch {
    // Ignore missing temporary refs during cleanup.
  }
}
