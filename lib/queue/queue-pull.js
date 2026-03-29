import { execGitFile } from '../shared/git/exec-git-file.js';
import {
  ensureQueueRepository,
  fetchQueueValidatedTip,
} from './queue-repository.js';
import { loadQueueConfig } from './queue-shared.js';
import { adoptReachableReadyRefs } from './queue-runtime.js';

export { pullQueue };

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   adopted_ready_refs: string[],
 *   outcome: 'success',
 *   resumed_runs: Array<{
 *     outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *     ready_ref: string,
 *   }>,
 * }>}
 */
async function pullQueue(repo_directory) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await ensureQueueRepository(
    repo_directory,
    queue_config,
  );

  await fetchQueueValidatedTip(
    repo_directory,
    queue_git_dir,
    queue_config.target_branch,
  );
  await execGitFile(['merge', '--no-ff', '--no-edit', 'FETCH_HEAD'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return adoptReachableReadyRefs(
    repo_directory,
    queue_git_dir,
    queue_config.ready_ref_prefix,
    'HEAD',
  );
}
