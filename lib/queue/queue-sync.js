/* eslint-disable max-lines-per-function */
import { rm } from 'node:fs/promises';

import { ensureQueueRepository } from './queue-repository.js';
import {
  abortMerge,
  checkoutQueueBase,
  createQueueTempRepo,
  deleteQueueRef,
  fetchQueueRef,
  fetchRefIntoQueueRepository,
  listReadyRefs,
  loadQueueConfig,
  mergeReadyRef,
  readRevision,
  resetQueueHead,
  resolveQueueBaseSource,
  updateQueueCandidateRef,
  updateValidatedQueueTip,
  writeQueueBaseSource,
} from './queue-shared.js';
import { appendResolvedRun, resolveQueueWait } from './queue-runtime.js';
import {
  loadQueueValidationFlow,
  validateQueueCandidate,
} from './queue-validation.js';

export { syncQueue };

/**
 * @param {string} repo_directory
 * @param {{
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 * }} [options]
 * @returns {Promise<{
 *   base_source: 'fetched-upstream' | 'local-target-branch',
 *   outcome: 'failure' | 'success',
 *   rejected_ready_refs: string[],
 *   resumed_runs: Array<{
 *     outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *     ready_ref: string,
 *   }>,
 * }>}
 */
async function syncQueue(repo_directory, options = {}) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await ensureQueueRepository(
    repo_directory,
    queue_config,
  );
  const validation_flow = await loadQueueValidationFlow(
    repo_directory,
    queue_config.validation_flow,
  );
  const queue_base_source = await resolveQueueBaseSource(
    repo_directory,
    queue_config,
  );

  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    queue_base_source.source_ref,
    queue_config.base_ref,
  );

  const ready_refs = await listReadyRefs(
    queue_git_dir,
    queue_config.ready_ref_prefix,
  );

  if (ready_refs.length === 0) {
    await updateQueueCandidateRef(
      queue_git_dir,
      queue_config.base_ref,
      queue_config.candidate_ref,
    );
    await updateValidatedQueueTip(
      queue_git_dir,
      queue_config.base_ref,
      queue_config.target_branch,
    );
    await writeQueueBaseSource(queue_git_dir, queue_base_source.base_source);

    return {
      base_source: queue_base_source.base_source,
      outcome: 'success',
      rejected_ready_refs: [],
      resumed_runs: [],
    };
  }

  const temp_directory = await createQueueTempRepo(queue_git_dir);
  /** @type {string[]} */
  const rejected_ready_refs = [];
  /** @type {Array<{
   *   outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
   *   ready_ref: string,
   * }>}
   */
  const resumed_runs = [];

  try {
    await checkoutQueueBase(temp_directory, queue_config.base_ref);

    for (const ready_ref of ready_refs) {
      await fetchQueueRef(temp_directory, ready_ref);
      const previous_head = await readRevision(temp_directory, 'HEAD');

      try {
        await mergeReadyRef(temp_directory, ready_ref);
      } catch {
        await abortMerge(temp_directory);
        await deleteQueueRef(queue_git_dir, ready_ref);
        rejected_ready_refs.push(ready_ref);

        const resumed_run = await resolveQueueWait(
          repo_directory,
          ready_ref,
          'failure',
        );

        appendResolvedRun(resumed_runs, ready_ref, resumed_run);
        break;
      }

      const validation_outcome = await validateQueueCandidate(
        repo_directory,
        temp_directory,
        ready_ref,
        validation_flow,
        options.operator_io,
      );

      if (validation_outcome === 'success') {
        continue;
      }

      await resetQueueHead(temp_directory, previous_head);
      await deleteQueueRef(queue_git_dir, ready_ref);
      rejected_ready_refs.push(ready_ref);

      const resumed_run = await resolveQueueWait(
        repo_directory,
        ready_ref,
        'failure',
      );

      appendResolvedRun(resumed_runs, ready_ref, resumed_run);
      break;
    }

    await updateQueueCandidateRef(
      temp_directory,
      'HEAD',
      queue_config.candidate_ref,
      queue_git_dir,
    );
    await updateValidatedQueueTip(
      temp_directory,
      'HEAD',
      queue_config.target_branch,
      queue_git_dir,
    );
    await writeQueueBaseSource(queue_git_dir, queue_base_source.base_source);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }

  return {
    base_source: queue_base_source.base_source,
    outcome: rejected_ready_refs.length > 0 ? 'failure' : 'success',
    rejected_ready_refs,
    resumed_runs,
  };
}
