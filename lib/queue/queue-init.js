import { loadQueueConfig, readQueueBaseSource } from './queue-shared.js';
import { initializeQueueRepository } from './queue-repository.js';

export { initQueue };

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   base_source: 'fetched-upstream' | 'local-target-branch',
 *   base_ref: string,
 *   candidate_ref: string,
 *   outcome: 'success',
 *   queue_git_dir: string,
 *   target_ref: string,
 * }>}
 */
async function initQueue(repo_directory) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await initializeQueueRepository(
    repo_directory,
    queue_config,
  );
  const base_source = await readQueueBaseSource(queue_git_dir);

  return {
    base_source,
    base_ref: queue_config.base_ref,
    candidate_ref: queue_config.candidate_ref,
    outcome: 'success',
    queue_git_dir,
    target_ref: `refs/heads/${queue_config.target_branch}`,
  };
}
