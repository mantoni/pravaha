import { globby } from 'globby';

import { loadExecutableDispatchFlow } from '../../flow/reconcile-flow.js';

export { loadDispatchFlowCandidates };

/**
 * @param {string} repo_directory
 * @param {string[]} default_matches
 * @returns {Promise<Array<{
 *   dispatch_flow: Awaited<ReturnType<typeof loadExecutableDispatchFlow>>,
 *   flow_path: string,
 * }>>}
 */
async function loadDispatchFlowCandidates(repo_directory, default_matches) {
  if (default_matches.length === 0) {
    return [];
  }

  const flow_paths = [
    ...new Set(
      await globby(default_matches, {
        cwd: repo_directory,
        expandDirectories: false,
        gitignore: true,
        onlyFiles: true,
      }),
    ),
  ].sort((left_path, right_path) => left_path.localeCompare(right_path, 'en'));

  return Promise.all(
    flow_paths.map(async (flow_path) => ({
      dispatch_flow: await loadExecutableDispatchFlow(
        repo_directory,
        flow_path,
      ),
      flow_path,
    })),
  );
}
