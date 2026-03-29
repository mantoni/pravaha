export {
  createPluginBindingTargets,
  createStateMachineJobMap,
  createStateMachineJobsContext,
  createStateMachineRuntimeRecordContext,
  createStateMachineWriteAttemptContext,
};

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   current_job_name: string,
 *   flow_path: string,
 *   format_version: 'state-machine-v2',
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 * }} runtime_record_context
 * @param {string} current_job_name
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @param {Record<string, number>} job_visit_counts
 * @param {{
 *   approved_at: string | null,
 *   requested_at: string,
 * } | undefined} approval
 * @param {{
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: 'failure' | 'success' | null,
 *   ready_ref: string,
 *   state: 'failed' | 'succeeded' | 'waiting',
 * } | undefined} queue_wait
 * @returns {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_targets?: {
 *     document?: { id: string, path: string, status: string },
 *     task?: { id: string, path: string, status: string },
 *   },
 *   contract_path: string,
 *   current_job_name: string,
 *   flow_path: string,
 *   format_version: 'state-machine-v2',
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   run_id?: string,
 *   task_id: string,
 *   task_path: string,
 *   transition_targets?: { failure: string, success: string },
 * }}
 */
function createStateMachineRuntimeRecordContext(
  runtime_record_context,
  current_job_name,
  job_outputs,
  job_visit_counts,
  approval,
  queue_wait,
) {
  return {
    ...runtime_record_context,
    approval,
    current_job_name,
    job_outputs,
    job_visit_counts,
    queue_wait,
  };
}

/**
 * @param {{
 *   current_job_name?: string,
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   prompt: string,
 *   run_id?: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }} attempt_context
 * @param {string} current_job_name
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @param {Record<string, number>} job_visit_counts
 * @returns {{
 *   current_job_name: string,
 *   job_outputs: Record<string, Record<string, unknown>>,
 *   job_visit_counts: Record<string, number>,
 *   prompt: string,
 *   run_id?: string,
 *   runtime_record_path: string,
 *   started_at?: string,
 *   worktree_assignment: {
 *     identity: string,
 *     mode: 'ephemeral' | 'named' | 'pooled',
 *     path: string,
 *     slot?: string,
 *   },
 *   worktree_path: string,
 * }}
 */
function createStateMachineWriteAttemptContext(
  attempt_context,
  current_job_name,
  job_outputs,
  job_visit_counts,
) {
  return {
    ...attempt_context,
    current_job_name,
    job_outputs,
    job_visit_counts,
  };
}

/**
 * @param {Array<
 *   | {
 *       end_state: string,
 *       job_name: string,
 *       kind: 'end',
 *     }
 *   | {
 *       job_name: string,
 *       kind: 'action',
 *       limits: { max_visits: number } | null,
 *       next_branches: Array<{
 *         condition_text: string | null,
 *         target_job_name: string,
 *       }>,
 *       uses_value: string,
 *       with_value: unknown,
 *     }
 * >} ordered_jobs
 * @returns {Map<
 *   string,
 *   | {
 *       end_state: string,
 *       job_name: string,
 *       kind: 'end',
 *     }
 *   | {
 *       job_name: string,
 *       kind: 'action',
 *       limits: { max_visits: number } | null,
 *       next_branches: Array<{
 *         condition_text: string | null,
 *         target_job_name: string,
 *       }>,
 *       uses_value: string,
 *       with_value: unknown,
 *     }
 * >}
 */
function createStateMachineJobMap(ordered_jobs) {
  return new Map(ordered_jobs.map((job) => [job.job_name, job]));
}

/**
 * @param {Record<string, Record<string, unknown>>} job_outputs
 * @returns {Record<string, { outputs: Record<string, unknown> }>}
 */
function createStateMachineJobsContext(job_outputs) {
  /** @type {Record<string, { outputs: Record<string, unknown> }>} */
  const jobs_context = {};

  for (const [job_name, output_record] of Object.entries(job_outputs)) {
    jobs_context[job_name] = {
      outputs: output_record,
    };
  }

  return jobs_context;
}

/**
 * @param {{ id: string, path: string, status: string } | undefined} document
 * @param {{ id: string, path: string, status: string }} task
 * @returns {{
 *   document?: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }}
 */
function createPluginBindingTargets(document, task) {
  /** @type {{
   *   document?: { id: string, path: string, status: string },
   *   task: { id: string, path: string, status: string },
   * }} */
  const binding_targets = {
    task,
  };

  if (document !== undefined) {
    binding_targets.document = document;
  }

  return binding_targets;
}
