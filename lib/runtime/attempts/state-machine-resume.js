/** @import { BuildGraphResult, QueryGraphApi } from '../../shared/types/patram-types.ts' */
import { loadStateMachineFlow } from '../../flow/reconcile-flow.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { createStateMachineResumeAttemptContext } from './runtime-attempt-records.js';
import { createRuntimePrompt } from './runtime-attempt-support.js';
import {
  collectDecisionPaths,
  refreshBindingTargets,
  resolveResumeWorkspaceDefinition,
} from './resume-support.js';
import { prepareWorkspace } from '../workspaces/runtime-files.js';

export { createResumedAttempt };

const RESUME_RUNTIME_LABEL = 'Resumed runtime';

/**
 * @param {string} repo_directory
 * @param {{
 *   durable_graph?: BuildGraphResult,
 *   graph_api?: QueryGraphApi,
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 * }} options
 * @returns {Promise<{
 *   attempt_context: ReturnType<typeof createStateMachineResumeAttemptContext> & {
 *     prompt: string,
 *     worktree_assignment: {
 *       identity: string,
 *       mode: 'ephemeral' | 'named' | 'pooled',
 *       path: string,
 *       slot?: string,
 *     },
 *     worktree_path: string,
 *   },
 *   ordered_jobs: Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'],
 * }>}
 */
async function createResumedAttempt(repo_directory, options) {
  const graph_api = resolveGraphApi(options.graph_api);
  const durable_graph =
    options.durable_graph ??
    (await graph_api.load_project_graph(repo_directory)).graph;
  const durable_attempt_context = createStateMachineResumeAttemptContext(
    repo_directory,
    options.runtime_record,
    options.runtime_record_path,
  );
  const state_machine_flow = await loadStateMachineFlow(
    repo_directory,
    durable_attempt_context.flow_path,
  );
  const refreshed_binding_targets = refreshBindingTargets(
    durable_graph,
    durable_attempt_context.binding_targets,
  );
  const decision_paths = collectDecisionPaths(
    durable_graph,
    durable_attempt_context.contract_path,
  );
  const resume_workspace = await resolveResumeWorkspaceDefinition(
    repo_directory,
    state_machine_flow.workspace,
    durable_attempt_context.recorded_worktree,
  );
  const worktree_assignment = await prepareWorkspace(
    repo_directory,
    resume_workspace,
  );

  return {
    attempt_context: {
      ...durable_attempt_context,
      binding_targets: refreshed_binding_targets,
      prompt: await createRuntimePrompt(repo_directory, {
        contract_path: durable_attempt_context.contract_path,
        decision_paths,
        flow_path: durable_attempt_context.flow_path,
        runtime_label: RESUME_RUNTIME_LABEL,
        task_path: durable_attempt_context.task_path,
      }),
      worktree_assignment,
      worktree_path: worktree_assignment.path,
    },
    ordered_jobs: state_machine_flow.ordered_jobs,
  };
}
