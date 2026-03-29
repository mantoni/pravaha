/* eslint-disable max-lines, max-lines-per-function */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadStateMachineFlow } from '../flow/reconcile-flow.js';
import { dispatchAssignmentAndWait } from '../runtime/dispatch/session.js';
import {
  createConcreteWorkspaceDefinition,
  RUNTIME_DIRECTORY,
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
 *   flow: Awaited<ReturnType<typeof loadStateMachineFlow>>,
 *   flow_path: string,
 * } | null>}
 */
async function loadQueueValidationFlow(repo_directory, validation_flow_path) {
  if (validation_flow_path === null) {
    return null;
  }

  return {
    flow: await loadStateMachineFlow(repo_directory, validation_flow_path),
    flow_path: validation_flow_path,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} temp_directory
 * @param {string} ready_ref
 * @param {{
 *   flow: Awaited<ReturnType<typeof loadStateMachineFlow>>,
 *   flow_path: string,
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
          document: {
            id: 'contract:queue-validation',
            path: QUEUE_VALIDATION_CONTRACT_PATH,
            status: 'active',
          },
          task: {
            id: `task:${task_id}`,
            path: task_path,
            status: 'ready',
          },
        },
        contract_path: QUEUE_VALIDATION_CONTRACT_PATH,
        decision_paths: [],
        flow_instance_id: task_id,
        flow_path: validation_flow.flow_path,
        ordered_jobs: validation_flow.flow.ordered_jobs,
        start_job_name: validation_flow.flow.start_job_name,
        task_id,
        task_path,
        type: 'assignment',
        workspace: createQueueValidationWorkspace(
          validation_flow.flow.workspace,
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
 * @param {{
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   source: {
 *     id?: string,
 *     ids?: string[],
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }} workspace_definition
 * @returns {{
 *   materialize: {
 *     kind: 'worktree',
 *     mode: 'ephemeral' | 'pooled',
 *     ref: string,
 *   },
 *   source: {
 *     id: string,
 *     kind: 'repo',
 *   },
 *   type: 'git.workspace',
 * }}
 */
function createQueueValidationWorkspace(workspace_definition) {
  const source_id = Array.isArray(workspace_definition.source.ids)
    ? workspace_definition.source.ids[0]
    : workspace_definition.source.id;

  /* c8 ignore next 3 */
  if (typeof source_id !== 'string') {
    throw new Error(
      'Expected queue validation workspace.source to expose an id.',
    );
  }

  return {
    ...createConcreteWorkspaceDefinition(workspace_definition, source_id),
    materialize: {
      kind: 'worktree',
      mode: 'ephemeral',
      ref: QUEUE_VALIDATION_REF,
    },
  };
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
