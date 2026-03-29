import { resumeTaskAttempt } from '../runtime/attempts/state-machine.js';
import { getRuntimeRecordQueueWait } from '../runtime/records/runtime-record-model.js';
import { listUnresolvedRuntimeRecords } from '../runtime/records/runtime-records.js';
import { writeRuntimeRecord } from '../runtime/workspaces/runtime-files.js';
import { resolveGraphApi } from '../shared/graph/resolve-graph-api.js';
import {
  deleteQueueRef,
  isAncestor,
  listReadyRefs,
  readRevisionFromGitDirectory,
} from './queue-shared.js';

export { adoptReachableReadyRefs, appendResolvedRun, resolveQueueWait };

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} ready_ref_prefix
 * @param {string} reachable_revision
 * @returns {Promise<{
 *   adopted_ready_refs: string[],
 *   outcome: 'success',
 *   resumed_runs: Array<{
 *     outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *     ready_ref: string,
 *   }>,
 * }>}
 */
async function adoptReachableReadyRefs(
  repo_directory,
  queue_git_dir,
  ready_ref_prefix,
  reachable_revision,
) {
  const ready_refs = await listReadyRefs(queue_git_dir, ready_ref_prefix);
  /** @type {string[]} */
  const adopted_ready_refs = [];
  /** @type {Array<{
   *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
   *   ready_ref: string,
   * }>}
   */
  const resumed_runs = [];

  for (const ready_ref of ready_refs) {
    const branch_head = await readRevisionFromGitDirectory(
      queue_git_dir,
      ready_ref,
    );
    const is_adopted = await isAncestor(
      repo_directory,
      branch_head,
      reachable_revision,
    );

    if (!is_adopted) {
      continue;
    }

    adopted_ready_refs.push(ready_ref);
    await deleteQueueRef(queue_git_dir, ready_ref);

    const resumed_run = await resolveQueueWait(
      repo_directory,
      ready_ref,
      'success',
    );

    appendResolvedRun(resumed_runs, ready_ref, resumed_run);
  }

  return {
    adopted_ready_refs,
    outcome: 'success',
    resumed_runs,
  };
}

/**
 * @param {string} repo_directory
 * @param {string} ready_ref
 * @param {'failure' | 'success'} outcome
 * @returns {Promise<Awaited<ReturnType<typeof resumeTaskAttempt>> | null>}
 */
async function resolveQueueWait(repo_directory, ready_ref, outcome) {
  const unresolved_runtime_records =
    await listUnresolvedRuntimeRecords(repo_directory);
  const matching_runtime_record = unresolved_runtime_records.find(
    (runtime_record) =>
      getRuntimeRecordQueueWait(runtime_record.record)?.ready_ref === ready_ref,
  );

  if (matching_runtime_record === undefined) {
    return null;
  }

  const queue_wait = getRuntimeRecordQueueWait(matching_runtime_record.record);

  /* c8 ignore next 3 */
  if (queue_wait === null) {
    return null;
  }

  const updated_runtime_record = {
    ...matching_runtime_record.record,
    queue_wait: {
      ...queue_wait,
      outcome,
      state: outcome === 'success' ? 'succeeded' : 'failed',
    },
  };

  await writeRuntimeRecord(
    matching_runtime_record.runtime_record_path,
    updated_runtime_record,
  );

  const graph_api = resolveGraphApi(undefined);
  const project_graph_result =
    await graph_api.load_project_graph(repo_directory);

  return resumeTaskAttempt(repo_directory, {
    durable_graph: project_graph_result.graph,
    graph_api: {
      query_graph: graph_api.query_graph,
    },
    relation_names: Object.keys(project_graph_result.config.relations ?? {}),
    runtime_record: updated_runtime_record,
    runtime_record_path: matching_runtime_record.runtime_record_path,
  });
}

/**
 * @param {Array<{
 *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *   ready_ref: string,
 * }>} resumed_runs
 * @param {string} ready_ref
 * @param {Awaited<ReturnType<typeof resumeTaskAttempt>> | null} resumed_run
 * @returns {void}
 */
function appendResolvedRun(resumed_runs, ready_ref, resumed_run) {
  if (resumed_run === null) {
    return;
  }

  resumed_runs.push({
    outcome: resumed_run.outcome,
    ready_ref,
  });
}
