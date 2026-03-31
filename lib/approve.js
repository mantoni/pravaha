/**
 * Approval ingress for unresolved plugin-backed runtime steps.
 *
 * Decided by: ../docs/decisions/runtime/approval-only-command-ingress.md
 * Implements: ../docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
 * @patram
 */
/** @import { OptionalGraphApi } from './shared/types/patram-types.ts' */
import { resolveGraphApi } from './shared/graph/resolve-graph-api.js';
import { resumeJavaScriptFlowAttempt } from './runtime/attempts/javascript-flow.js';
import { loadSingleUnresolvedRuntimeRecordByToken } from './runtime/records/runtime-records.js';
import { writeRuntimeRecord } from './runtime/workspaces/runtime-files.js';

export { approve };

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   token: string,
 * }} options
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   prompt: string,
 *   root_flow_path: string,
 *   runtime_record_path: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_error: string | null,
 *   worker_final_response: string | null,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }>}
 */
async function approve(repo_directory, options) {
  const now = options.now ?? createCurrentDate;
  const approval_token = readApprovalToken(options.token);
  const unresolved_runtime_record =
    await loadSingleUnresolvedRuntimeRecordByToken(
      repo_directory,
      approval_token,
    );
  const approved_runtime_record = markRuntimeRecordApproved(
    unresolved_runtime_record.record,
    now,
  );

  await writeRuntimeRecord(
    unresolved_runtime_record.runtime_record_path,
    approved_runtime_record,
  );

  const graph_api = resolveGraphApi(options.graph_api);
  const project_graph_result =
    await graph_api.load_project_graph(repo_directory);

  return resumeJavaScriptFlowAttempt(repo_directory, {
    durable_graph: project_graph_result.graph,
    graph_api: {
      query_graph: graph_api.query_graph,
    },
    now,
    operator_io: options.operator_io,
    runtime_record: approved_runtime_record,
    runtime_record_path: unresolved_runtime_record.runtime_record_path,
  });
}

/**
 * @param {string} token
 * @returns {string}
 */
function readApprovalToken(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Expected approve to receive a non-empty approval token.');
  }

  return token;
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @param {() => Date} now
 * @returns {Record<string, unknown>}
 */
function markRuntimeRecordApproved(runtime_record, now) {
  const approval = /** @type {{
   *   approved_at?: unknown,
   *   requested_at?: unknown,
   * } | null} */ (
    runtime_record.approval !== null &&
    typeof runtime_record.approval === 'object'
      ? runtime_record.approval
      : null
  );

  /* istanbul ignore next -- filtered by approval-token lookup before approval */
  if (
    approval === null ||
    typeof approval.requested_at !== 'string' ||
    (approval.approved_at !== null && typeof approval.approved_at !== 'string')
  ) {
    throw new Error(
      'Expected the unresolved runtime record to request approval.',
    );
  }

  return {
    ...runtime_record,
    approval: {
      ...approval,
      approved_at: now().toISOString(),
    },
  };
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
}
