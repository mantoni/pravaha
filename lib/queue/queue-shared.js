/* eslint-disable max-lines */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPravahaConfig } from '../config/load-pravaha-config.js';
import { execGitFile } from '../shared/git/exec-git-file.js';

export {
  abortMerge,
  checkoutQueueBase,
  createQueueTempRepo,
  deleteQueueRef,
  fetchQueueCandidate,
  fetchQueueRef,
  fetchRefIntoQueueRepository,
  isAncestor,
  listReadyRefs,
  loadQueueConfig,
  mergeReadyRef,
  readNextReadyRefIndex,
  readQueueBaseSource,
  readRevision,
  readRevisionFromGitDirectory,
  resetQueueHead,
  resolveBranchRef,
  resolveQueueBaseSource,
  sanitizeReadyRefSuffix,
  updateQueueCandidateRef,
  updateValidatedQueueTip,
  writeQueueBaseSource,
};

const FETCHED_UPSTREAM_BASE_SOURCE = 'fetched-upstream';
const LOCAL_TARGET_BRANCH_BASE_SOURCE = 'local-target-branch';
const QUEUE_BASE_SOURCE_CONFIG_KEY = 'pravaha.queueBaseSource';

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

  /* c8 ignore next 3 */
  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(pravaha_config_result.diagnostics[0].message);
  }

  return pravaha_config_result.config.queue_config;
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
    /* c8 ignore next 4 */
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
 * @param {string} temp_directory
 * @param {string} revision
 * @returns {Promise<void>}
 */
async function resetQueueHead(temp_directory, revision) {
  await execGitFile(['reset', '--hard', revision], {
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
 * @returns {Promise<{
 *   base_source: 'fetched-upstream' | 'local-target-branch',
 *   source_ref: string,
 * }>}
 */
async function resolveQueueBaseSource(repo_directory, queue_config) {
  try {
    await execGitFile(['remote', 'get-url', queue_config.upstream_remote], {
      cwd: repo_directory,
      encoding: 'utf8',
    });
  } catch (error) {
    if (isMissingUpstreamRemoteError(error)) {
      return {
        base_source: LOCAL_TARGET_BRANCH_BASE_SOURCE,
        source_ref: `refs/heads/${queue_config.target_branch}`,
      };
    }

    throw createUpstreamRemoteResolutionError(
      queue_config.upstream_remote,
      error,
    );
  }

  try {
    await execGitFile(
      ['fetch', queue_config.upstream_remote, queue_config.target_branch],
      {
        cwd: repo_directory,
        encoding: 'utf8',
      },
    );
  } catch (error) {
    throw createUpstreamBaseFetchError(queue_config, error);
  }

  return {
    base_source: FETCHED_UPSTREAM_BASE_SOURCE,
    source_ref: `refs/remotes/${queue_config.upstream_remote}/${queue_config.target_branch}`,
  };
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
 * @param {string} queue_git_dir
 * @param {'fetched-upstream' | 'local-target-branch'} base_source
 * @returns {Promise<void>}
 */
async function writeQueueBaseSource(queue_git_dir, base_source) {
  await execGitFile(
    [
      '--git-dir',
      queue_git_dir,
      'config',
      '--local',
      QUEUE_BASE_SOURCE_CONFIG_KEY,
      base_source,
    ],
    {
      encoding: 'utf8',
    },
  );
}

/**
 * @param {string} queue_git_dir
 * @returns {Promise<'fetched-upstream' | 'local-target-branch'>}
 */
async function readQueueBaseSource(queue_git_dir) {
  try {
    const { stdout } = await execGitFile(
      [
        '--git-dir',
        queue_git_dir,
        'config',
        '--local',
        '--get',
        QUEUE_BASE_SOURCE_CONFIG_KEY,
      ],
      {
        encoding: 'utf8',
      },
    );
    const base_source = stdout.trim();

    if (
      base_source !== FETCHED_UPSTREAM_BASE_SOURCE &&
      base_source !== LOCAL_TARGET_BRANCH_BASE_SOURCE
    ) {
      /* c8 ignore next 3 */
      throw new Error(
        `Expected queue base source metadata to be "${FETCHED_UPSTREAM_BASE_SOURCE}" or "${LOCAL_TARGET_BRANCH_BASE_SOURCE}".`,
      );
    }

    return base_source;
  } catch (error) {
    throw new Error(
      'Expected queue base source metadata. Run "pravaha queue sync" before publishing.',
      {
        cause: error,
      },
    );
  }
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

/**
 * @param {{
 *   target_branch: string,
 *   upstream_remote: string,
 * }} queue_config
 * @param {unknown} error
 * @returns {Error}
 */
function createUpstreamBaseFetchError(queue_config, error) {
  return new Error(
    `Failed to fetch upstream base from remote "${queue_config.upstream_remote}" branch "${queue_config.target_branch}". ${readGitFailureMessage(error)}`,
    {
      cause: error instanceof Error ? error : undefined,
    },
  );
}

/**
 * @param {string} upstream_remote
 * @param {unknown} error
 * @returns {Error}
 */
function createUpstreamRemoteResolutionError(upstream_remote, error) {
  return new Error(
    `Failed to inspect upstream remote "${upstream_remote}". ${readGitFailureMessage(error)}`,
    {
      cause: error instanceof Error ? error : undefined,
    },
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingUpstreamRemoteError(error) {
  return /no such remote/i.test(readGitFailureMessage(error));
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readGitFailureMessage(error) {
  if (
    error instanceof Error &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim() !== ''
  ) {
    return error.stderr.trim();
  }

  if (error instanceof Error) {
    return error.message.trim();
  }

  /* c8 ignore next */
  return String(error).trim();
}
