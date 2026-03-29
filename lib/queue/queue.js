/* eslint-disable max-lines, max-lines-per-function */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPravahaConfig } from '../config/load-pravaha-config.js';
import { resolveGraphApi } from '../shared/graph/resolve-graph-api.js';
import { execGitFile } from '../shared/git/exec-git-file.js';
import { resumeTaskAttempt } from '../runtime/attempts/state-machine.js';
import { listUnresolvedRuntimeRecords } from '../runtime/records/runtime-records.js';
import { getRuntimeRecordQueueWait } from '../runtime/records/runtime-record-model.js';
import { writeRuntimeRecord } from '../runtime/workspaces/runtime-files.js';

export { enqueueQueueHandoff, initQueue, pullQueue, publishQueue, syncQueue };

const QUEUE_HOOK_NAMES = ['pre-receive', 'update'];

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

/**
 * @param {string} repo_directory
 * @returns {Promise<{
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

  return {
    base_ref: queue_config.base_ref,
    candidate_ref: queue_config.candidate_ref,
    outcome: 'success',
    queue_git_dir,
    target_ref: `refs/heads/${queue_config.target_branch}`,
  };
}

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   outcome: 'failure' | 'success',
 *   rejected_ready_refs: string[],
 *   resumed_runs: Array<{
 *     outcome: 'failure' | 'pending-approval' | 'pending-queue' | 'success',
 *     ready_ref: string,
 *   }>,
 * }>}
 */
async function syncQueue(repo_directory) {
  const queue_config = await loadQueueConfig(repo_directory);
  const queue_git_dir = await ensureQueueRepository(
    repo_directory,
    queue_config,
  );
  const base_source_ref = await resolveBaseSourceRef(
    repo_directory,
    queue_config,
  );

  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    base_source_ref,
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

    return {
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

        continue;
      }
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
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }

  return {
    outcome: rejected_ready_refs.length > 0 ? 'failure' : 'success',
    rejected_ready_refs,
    resumed_runs,
  };
}

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

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   adopted_ready_refs: string[],
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
    published_head,
  };
}

/**
 * @param {string} repo_directory
 * @returns {Promise<{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   ready_ref_prefix: string,
 *   target_branch: string,
 *   upstream_remote: string,
 *   validation_flow: string | null,
 * }>}
 */
async function loadQueueConfig(repo_directory) {
  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(pravaha_config_result.diagnostics[0].message);
  }

  return pravaha_config_result.config.queue_config;
}

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
 * @param {string} queue_git_dir
 * @param {string} ready_ref
 * @returns {Promise<void>}
 */
async function deleteQueueRef(queue_git_dir, ready_ref) {
  await execGitFile(
    ['--git-dir', queue_git_dir, 'update-ref', '-d', ready_ref],
    {
      cwd: queue_git_dir,
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} source_ref
 * @param {string} target_ref
 * @returns {Promise<void>}
 */
async function fetchRefIntoQueueRepository(
  repo_directory,
  queue_git_dir,
  source_ref,
  target_ref,
) {
  await execGitFile(
    [
      '--git-dir',
      queue_git_dir,
      'fetch',
      repo_directory,
      `+${source_ref}:${target_ref}`,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function abortMerge(temp_directory) {
  try {
    await execGitFile(['merge', '--abort'], {
      cwd: temp_directory,
      encoding: 'utf8',
    });
  } catch {
    await execGitFile(['reset', '--hard', 'HEAD'], {
      cwd: temp_directory,
      encoding: 'utf8',
    });
  }
}

/**
 * @param {string} temp_directory
 * @param {string} base_ref
 * @returns {Promise<void>}
 */
async function checkoutQueueBase(temp_directory, base_ref) {
  await execGitFile(['fetch', 'origin', `${base_ref}:${base_ref}`], {
    cwd: temp_directory,
    encoding: 'utf8',
  });
  await execGitFile(['checkout', '--detach', base_ref], {
    cwd: temp_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} queue_git_dir
 * @returns {Promise<string>}
 */
async function createQueueTempRepo(queue_git_dir) {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-queue-sync-'));

  await execGitFile(['clone', queue_git_dir, temp_directory], {
    cwd: queue_git_dir,
    encoding: 'utf8',
  });
  await execGitFile(['config', 'user.email', 'pravaha@example.com'], {
    cwd: temp_directory,
    encoding: 'utf8',
  });
  await execGitFile(['config', 'user.name', 'Pravaha Queue'], {
    cwd: temp_directory,
    encoding: 'utf8',
  });

  return temp_directory;
}

/**
 * @param {string} repo_directory
 * @param {{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @returns {Promise<string>}
 */
async function ensureQueueRepository(repo_directory, queue_config) {
  const queue_git_dir = join(repo_directory, queue_config.dir);

  try {
    await execGitFile(['--git-dir', queue_git_dir, 'rev-parse', '--git-dir'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    return queue_git_dir;
  } catch {
    return initializeQueueRepository(repo_directory, queue_config);
  }
}

/**
 * @param {string} repo_directory
 * @param {{
 *   base_ref: string,
 *   candidate_ref: string,
 *   dir: string,
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @returns {Promise<string>}
 */
async function initializeQueueRepository(repo_directory, queue_config) {
  const queue_git_dir = join(repo_directory, queue_config.dir);
  const base_source_ref = await resolveBaseSourceRef(
    repo_directory,
    queue_config,
  );

  await ensureBareQueueRepository(
    repo_directory,
    queue_git_dir,
    queue_config.target_branch,
  );
  await installQueueHooks(queue_git_dir);
  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    base_source_ref,
    queue_config.base_ref,
  );
  await updateQueueCandidateRef(
    repo_directory,
    base_source_ref,
    queue_config.candidate_ref,
    queue_git_dir,
  );
  await updateValidatedQueueTip(
    repo_directory,
    base_source_ref,
    queue_config.target_branch,
    queue_git_dir,
  );

  return queue_git_dir;
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} target_branch
 * @returns {Promise<void>}
 */
async function ensureBareQueueRepository(
  repo_directory,
  queue_git_dir,
  target_branch,
) {
  try {
    await execGitFile(['--git-dir', queue_git_dir, 'rev-parse', '--git-dir'], {
      cwd: repo_directory,
      encoding: 'utf8',
    });

    return;
  } catch {
    await execGitFile(
      ['init', '--bare', `--initial-branch=${target_branch}`, queue_git_dir],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );
  }
}

/**
 * @param {string} queue_git_dir
 * @returns {Promise<void>}
 */
async function installQueueHooks(queue_git_dir) {
  for (const hook_name of QUEUE_HOOK_NAMES) {
    const hook_path = join(queue_git_dir, 'hooks', hook_name);

    await writeFile(hook_path, createQueueHookScript(hook_name), 'utf8');
    await chmod(hook_path, 0o755);
  }
}

/**
 * @param {string} temp_directory
 * @param {string} ready_ref
 * @returns {Promise<void>}
 */
async function fetchQueueRef(temp_directory, ready_ref) {
  await execGitFile(['fetch', 'origin', `${ready_ref}:${ready_ref}`], {
    cwd: temp_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} candidate_ref
 * @returns {Promise<void>}
 */
async function fetchQueueCandidate(
  repo_directory,
  queue_git_dir,
  candidate_ref,
) {
  await execGitFile(['fetch', queue_git_dir, candidate_ref], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @param {string} ready_ref_prefix
 * @param {string} queue_git_dir
 * @param {string} branch_ref
 * @param {string} run_id
 * @returns {Promise<string>}
 */
async function allocateReadyRef(
  repo_directory,
  ready_ref_prefix,
  queue_git_dir,
  branch_ref,
  run_id,
) {
  const ready_refs = await listReadyRefs(queue_git_dir, ready_ref_prefix);
  const next_index = readNextReadyRefIndex(ready_refs);
  const suffix = sanitizeReadyRefSuffix(branch_ref, run_id);

  void repo_directory;

  return `${ready_ref_prefix}/${String(next_index).padStart(4, '0')}-${suffix}`;
}

/**
 * @param {string} repo_directory
 * @param {string} queue_git_dir
 * @param {string} target_branch
 * @returns {Promise<void>}
 */
async function fetchQueueValidatedTip(
  repo_directory,
  queue_git_dir,
  target_branch,
) {
  await fetchQueueCandidate(
    repo_directory,
    queue_git_dir,
    `refs/heads/${target_branch}`,
  );
}

/**
 * @param {string} queue_git_dir
 * @param {string} ready_ref_prefix
 * @returns {Promise<string[]>}
 */
async function listReadyRefs(queue_git_dir, ready_ref_prefix) {
  const { stdout } = await execGitFile(
    [
      '--git-dir',
      queue_git_dir,
      'for-each-ref',
      '--format=%(refname)',
      '--sort=refname',
      ready_ref_prefix,
    ],
    {
      cwd: queue_git_dir,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * @param {string} temp_directory
 * @param {string} ready_ref
 * @returns {Promise<void>}
 */
async function mergeReadyRef(temp_directory, ready_ref) {
  await execGitFile(['merge', '--no-ff', '--no-edit', ready_ref], {
    cwd: temp_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_ref
 * @param {string} reachable_revision
 * @returns {Promise<boolean>}
 */
async function isAncestor(repo_directory, branch_ref, reachable_revision) {
  try {
    await execGitFile(
      ['merge-base', '--is-ancestor', branch_ref, reachable_revision],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    return true;
  } catch {
    return false;
  }
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
 * @param {string} repo_directory
 * @param {string} branch_value
 * @returns {Promise<string>}
 */
async function resolveBranchRef(repo_directory, branch_value) {
  const branch_ref = branch_value.startsWith('refs/')
    ? branch_value
    : `refs/heads/${branch_value}`;

  await execGitFile(['rev-parse', '--verify', branch_ref], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return branch_ref;
}

/**
 * @param {string} repo_directory
 * @param {{
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @returns {Promise<string>}
 */
async function resolveBaseSourceRef(repo_directory, queue_config) {
  try {
    await execGitFile(['remote', 'get-url', queue_config.upstream_remote], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
    await execGitFile(
      ['fetch', queue_config.upstream_remote, queue_config.target_branch],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );

    return `refs/remotes/${queue_config.upstream_remote}/${queue_config.target_branch}`;
  } catch {
    return `refs/heads/${queue_config.target_branch}`;
  }
}

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(['rev-parse', revision], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} queue_git_dir
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevisionFromGitDirectory(queue_git_dir, revision) {
  const { stdout } = await execGitFile(
    ['--git-dir', queue_git_dir, 'rev-parse', revision],
    {
      cwd: queue_git_dir,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}

/**
 * @param {string[]} ready_refs
 * @returns {number}
 */
function readNextReadyRefIndex(ready_refs) {
  let next_index = 1;

  for (const ready_ref of ready_refs) {
    const match = ready_ref.match(/\/(\d+)-/u);

    if (match === null) {
      continue;
    }

    const parsed_index = Number.parseInt(match[1], 10);

    if (parsed_index >= next_index) {
      next_index = parsed_index + 1;
    }
  }

  return next_index;
}

/**
 * @param {string} branch_ref
 * @param {string} run_id
 * @returns {string}
 */
function sanitizeReadyRefSuffix(branch_ref, run_id) {
  const branch_suffix = branch_ref
    .replace(/^refs\/heads\//u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const run_suffix = run_id
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return `${branch_suffix}-${run_suffix}`.toLowerCase();
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

/**
 * @param {string} hook_name
 * @returns {string}
 */
function createQueueHookScript(hook_name) {
  return [
    '#!/usr/bin/env node',
    '',
    `const HOOK_NAME = ${JSON.stringify(hook_name)};`,
    'const ZERO_OID_PATTERN = /^0+$/u;',
    'const READY_REF_PATTERN = /^refs\\/queue\\/ready\\/\\d{4,}-[a-z0-9][a-z0-9-]*$/u;',
    "const MANAGED_PREFIXES = ['refs/heads/', 'refs/queue/candidate/', 'refs/queue/meta/'];",
    '',
    'main().catch((error) => {',
    '  const message = error instanceof Error ? error.message : String(error);',
    '  process.stderr.write(`${message}\\n`);',
    '  process.exit(1);',
    '});',
    '',
    'async function main() {',
    '  const updates = await readUpdates();',
    '  const violations = updates',
    '    .map(validateUpdate)',
    '    .filter((violation) => violation !== null);',
    '',
    '  if (violations.length === 0) {',
    '    return;',
    '  }',
    '',
    '  for (const violation of violations) {',
    '    process.stderr.write(`${violation}\\n`);',
    '  }',
    '',
    '  process.exit(1);',
    '}',
    '',
    'function validateUpdate(update) {',
    '  const { new_oid, old_oid, ref_name } = update;',
    '  const is_delete = ZERO_OID_PATTERN.test(new_oid);',
    '  const is_create = ZERO_OID_PATTERN.test(old_oid);',
    '',
    '  if (READY_REF_PATTERN.test(ref_name)) {',
    '    if (!is_create) {',
    '      return `Queue ready refs are immutable: ${ref_name}`;',
    '    }',
    '',
    '    if (is_delete) {',
    '      return `Queue ready refs must point to a commit: ${ref_name}`;',
    '    }',
    '',
    '    return null;',
    '  }',
    '',
    '  if (MANAGED_PREFIXES.some((prefix) => ref_name.startsWith(prefix))) {',
    '    return `Direct mutation of managed queue refs is not allowed: ${ref_name}`;',
    '  }',
    '',
    '  return `Unsupported queue ref update: ${ref_name}`;',
    '}',
    '',
    'async function readUpdates() {',
    "  if (HOOK_NAME === 'update') {",
    '    const [, , ref_name, old_oid, new_oid] = process.argv;',
    '',
    '    return [{ new_oid, old_oid, ref_name }];',
    '  }',
    '',
    "  process.stdin.setEncoding('utf8');",
    "  let stdin_text = '';",
    '',
    '  for await (const chunk of process.stdin) {',
    '    stdin_text += chunk;',
    '  }',
    '',
    '  return stdin_text',
    "    .split('\\n')",
    '    .map((line) => line.trim())',
    "    .filter((line) => line !== '')",
    '    .map((line) => {',
    '      const [old_oid, new_oid, ref_name] = line.split(/\\s+/u);',
    '',
    '      return { new_oid, old_oid, ref_name };',
    '    });',
    '}',
    '',
  ].join('\n');
}

/**
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} candidate_ref
 * @param {string} [queue_git_dir]
 * @returns {Promise<void>}
 */
async function updateQueueCandidateRef(
  repo_directory,
  source_ref,
  candidate_ref,
  queue_git_dir = repo_directory,
) {
  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    source_ref,
    candidate_ref,
  );
}

/**
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} target_branch
 * @param {string} [queue_git_dir]
 * @returns {Promise<void>}
 */
async function updateValidatedQueueTip(
  repo_directory,
  source_ref,
  target_branch,
  queue_git_dir = repo_directory,
) {
  await fetchRefIntoQueueRepository(
    repo_directory,
    queue_git_dir,
    source_ref,
    `refs/heads/${target_branch}`,
  );
}
