import {
  fetchRefIntoQueueRepository,
  loadQueueConfig,
  readRevision,
  resolveBranchRef,
} from './queue-shared.js';
import { allocateReadyRef, ensureQueueRepository } from './queue-repository.js';

export { enqueueQueueHandoff };

/**
 * @param {string} repo_directory
 * @param {{
 *   branch_value: string,
 *   run_id: string,
 * }} options
 * @returns {Promise<{
 *   branch_head: string,
 *   branch_ref: string,
 *   outcome: null,
 *   ready_ref: string,
 *   state: 'waiting',
 * }>}
 */
async function enqueueQueueHandoff(repo_directory, options) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await ensureQueueRepository(
    repo_directory,
    queue_config,
  );
  const branch_ref = await resolveBranchRef(
    repo_directory,
    options.branch_value,
  );
  const branch_head = await readRevision(repo_directory, branch_ref);
  const ready_ref = await allocateReadyRef(
    repo_directory,
    queue_config.ready_ref_prefix,
    queue_git_dir,
    branch_ref,
    options.run_id,
  );

  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    branch_ref,
    ready_ref,
  );

  return {
    branch_head,
    branch_ref,
    outcome: null,
    ready_ref,
    state: 'waiting',
  };
}
