/** @import { OptionalGraphApi } from './patram-types.ts' */
import { resolveGraphApi } from './reconcile-graph.js';
import { loadSingleUnresolvedRuntimeRecord } from './runtime-records.js';
import { resumeTaskAttempt } from './runtime-attempt.js';

export { resume };

/**
 * @param {string} repo_directory
 * @param {{
 *   graph_api?: OptionalGraphApi,
 *   now?: () => Date,
 *   worker_client?: {
 *     resumeThread?: (
 *       id: string,
 *       thread_options?: import('@openai/codex-sdk').ThreadOptions,
 *     ) => {
 *       id: string | null,
 *       run: (
 *         input: string,
 *         turn_options?: import('@openai/codex-sdk').TurnOptions,
 *       ) => Promise<import('@openai/codex-sdk').RunResult>,
 *     },
 *     startThread: (
 *       thread_options?: import('@openai/codex-sdk').ThreadOptions,
 *     ) => {
 *       id: string | null,
 *       run: (
 *         input: string,
 *         turn_options?: import('@openai/codex-sdk').TurnOptions,
 *       ) => Promise<import('@openai/codex-sdk').RunResult>,
 *     },
 *   },
 * }} [options]
 * @returns {Promise<{
 *   contract_path: string,
 *   outcome: 'failure' | 'success',
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
async function resume(repo_directory, options = {}) {
  const unresolved_runtime_record =
    await loadSingleUnresolvedRuntimeRecord(repo_directory);
  const graph_api = resolveGraphApi(options.graph_api);
  const project_graph_result =
    await graph_api.load_project_graph(repo_directory);

  return resumeTaskAttempt(repo_directory, {
    durable_graph: project_graph_result.graph,
    graph_api: {
      query_graph: graph_api.query_graph,
    },
    now: options.now,
    relation_names: Object.keys(project_graph_result.config.relations ?? {}),
    runtime_record: unresolved_runtime_record.record,
    runtime_record_path: unresolved_runtime_record.runtime_record_path,
    worker_client: options.worker_client,
  });
}
