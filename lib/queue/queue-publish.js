import { execGitFile } from '../shared/git/exec-git-file.js';
import {
  ensureQueueRepository,
  fetchQueueValidatedTip,
} from './queue-repository.js';
import {
  loadQueueConfig,
  readQueueBaseSource,
  readRevision,
} from './queue-shared.js';
import { adoptReachableReadyRefs } from './queue-runtime.js';

export { publishQueue };

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   adopted_ready_refs: string[],
 *   base_source: 'fetched-upstream' | 'local-target-branch',
 *   outcome: 'success',
 *   published_head: string,
 *   resumed_runs: Array<{
 *     outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *     ready_ref: string,
 *   }>,
 * }>}
 */
async function publishQueue(repo_directory) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await ensureQueueRepository(
    repo_directory,
    queue_config,
  );
  const base_source = await readQueueBaseSource(queue_git_dir);

  await fetchQueueValidatedTip(
    repo_directory,
    queue_git_dir,
    queue_config.target_branch,
  );
  await execGitFile(
    [
      'push',
      queue_config.upstream_remote,
      `FETCH_HEAD:refs/heads/${queue_config.target_branch}`,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  const published_head = await readRevision(repo_directory, 'FETCH_HEAD');
  const adoption_result = await adoptReachableReadyRefs(
    repo_directory,
    queue_git_dir,
    queue_config.ready_ref_prefix,
    published_head,
  );

  return {
    ...adoption_result,
    base_source,
    published_head,
  };
}
