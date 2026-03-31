/* eslint-disable max-lines */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadPravahaConfig } from '../config/load-pravaha-config.js';
import { runJavaScriptFlowAttempt } from '../runtime/attempts/javascript-flow.js';
import { execGitFile } from '../shared/git/exec-git-file.js';
import { FLOW_PATH } from '../../test/fixtures/reconcile-fixture.js';
import {
  createPravahaConfigSource,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';
import { createReconcilerFixtureRepo } from '../../test/fixtures/reconcile-fixture.js';

export {
  appendBranchCommit,
  createBranchCommit,
  createQueueFixtureRepo,
  fetchQueueRef,
  isQueueRevisionAncestor,
  isRevisionAncestor,
  listQueueValidationRuntimeRecords,
  listReadyRefs,
  parseRuntimeRecord,
  pushQueueRef,
  readGitConfig,
  readHook,
  readQueueRevision,
  readRevision,
  startQueueRun,
  writeQueueValidationFlow,
};

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

/**
 * @param {{
 *   branch_step_lines: string[],
 * }} options
 * @returns {Promise<string>}
 */
async function createQueueFixtureRepo(options) {
  return createReconcilerFixtureRepo({
    flow_module_source: createQueueFlowModuleSource(options.branch_step_lines),
  });
}

/**
 * @param {string} repo_directory
 * @returns {Promise<Awaited<ReturnType<typeof runJavaScriptFlowAttempt>>>}
 */
async function startQueueRun(repo_directory) {
  return runJavaScriptFlowAttempt(repo_directory, {
    contract_path: CONTRACT_PATH,
    flow_instance_id: 'implement-runtime-slice',
    flow_path: FLOW_PATH,
    runtime_label: 'Queue runtime test',
    task_id: 'implement-runtime-slice',
    task_path: TASK_PATH,
    workspace: {
      id: 'app',
    },
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function createBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
) {
  await writeBranchCommit(repo_directory, branch_name, file_name, file_lines, {
    create_branch: true,
  });
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function appendBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
) {
  await writeBranchCommit(repo_directory, branch_name, file_name, file_lines, {
    create_branch: false,
  });
}

/**
 * @param {string} repo_directory
 * @param {string} file_name
 * @param {string[]} file_lines
 * @returns {Promise<void>}
 */
async function writeQueueFile(repo_directory, file_name, file_lines) {
  await writeFile(
    join(repo_directory, file_name),
    `${file_lines.join('\n')}\n`,
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string[]>}
 */
async function listReadyRefs(repo_directory) {
  const { stdout } = await execGitFile(
    [
      '--git-dir',
      getQueueGitDirectory(repo_directory),
      'for-each-ref',
      '--format=%(refname)',
      'refs/queue/ready',
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} target_ref
 * @returns {Promise<void>}
 */
async function fetchQueueRef(repo_directory, source_ref, target_ref) {
  await execGitFile(
    [
      '--git-dir',
      getQueueGitDirectory(repo_directory),
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
 * @param {string} repo_directory
 * @param {string} source_ref
 * @param {string} target_ref
 * @param {boolean} [force]
 * @returns {Promise<string>}
 */
async function pushQueueRef(
  repo_directory,
  source_ref,
  target_ref,
  force = false,
) {
  /** @type {string[]} */
  const push_arguments = ['push'];

  if (force) {
    push_arguments.push('--force');
  }

  push_arguments.push(
    getQueueGitDirectory(repo_directory),
    `${source_ref}:${target_ref}`,
  );

  const { stderr, stdout } = await execGitFile(push_arguments, {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return `${stdout}${stderr}`;
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
 * @param {string} repo_directory
 * @param {string} key
 * @returns {Promise<string>}
 */
async function readGitConfig(repo_directory, key) {
  const { stdout } = await execGitFile(['config', '--get', key], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} ancestor_revision
 * @param {string} descendant_revision
 * @returns {Promise<boolean>}
 */
async function isRevisionAncestor(
  repo_directory,
  ancestor_revision,
  descendant_revision,
) {
  try {
    await execGitFile(
      ['merge-base', '--is-ancestor', ancestor_revision, descendant_revision],
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
 * @param {string} ancestor_revision
 * @param {string} descendant_revision
 * @returns {Promise<boolean>}
 */
async function isQueueRevisionAncestor(
  repo_directory,
  ancestor_revision,
  descendant_revision,
) {
  try {
    await execGitFile(
      [
        '--git-dir',
        getQueueGitDirectory(repo_directory),
        'merge-base',
        '--is-ancestor',
        ancestor_revision,
        descendant_revision,
      ],
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
 * @param {string} command
 * @param {'failure' | 'success'} [end_state]
 * @returns {Promise<void>}
 */
async function writeQueueValidationFlow(
  repo_directory,
  command,
  end_state = 'success',
) {
  await linkPravahaPackage(repo_directory);
  const pravaha_config_result = await loadPravahaConfig(repo_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    throw new Error(pravaha_config_result.diagnostics[0]?.message);
  }

  await writeFile(
    join(repo_directory, 'pravaha.config.js'),
    createPravahaConfigSource({
      flows: [...pravaha_config_result.config.flow_config.matches],
      queue: {
        ...pravaha_config_result.config.queue_config,
        validation_flow: 'docs/flows/runtime/queue-validation.js',
      },
      workspaces: {
        ...pravaha_config_result.config.workspace_config,
      },
    }),
  );
  await writeFile(
    join(repo_directory, 'docs/flows/runtime/queue-validation.js'),
    createQueueValidationFlowDocumentText(command, end_state),
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string[]>}
 */
async function listQueueValidationRuntimeRecords(repo_directory) {
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const { stdout } = await execGitFile(
    [
      '-C',
      repo_directory,
      'ls-files',
      '--others',
      '--exclude-standard',
      runtime_directory,
    ],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('queue-validation'));
}

/**
 * @param {string} repo_directory
 * @param {string} hook_name
 * @returns {Promise<string>}
 */
async function readHook(repo_directory, hook_name) {
  return readFile(
    join(getQueueGitDirectory(repo_directory), 'hooks', hook_name),
    'utf8',
  );
}

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readQueueRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(
    ['--git-dir', getQueueGitDirectory(repo_directory), 'rev-parse', revision],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  return stdout.trim();
}

/**
 * @param {string} runtime_record_text
 * @returns {{
 *   local_outcome: { state: string },
 *   queue_wait?: { state: string },
 * }}
 */
function parseRuntimeRecord(runtime_record_text) {
  const parsed_value = /** @type {unknown} */ (JSON.parse(runtime_record_text));

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error('Expected runtime record JSON to evaluate to an object.');
  }

  const runtime_record = /** @type {{
   *   local_outcome: { state: string },
   *   queue_wait?: { state: string },
   * }} */ (parsed_value);

  return runtime_record;
}

/**
 * @param {string} repo_directory
 * @param {string} branch_name
 * @param {string} file_name
 * @param {string[]} file_lines
 * @param {{ create_branch: boolean }} options
 * @returns {Promise<void>}
 */
async function writeBranchCommit(
  repo_directory,
  branch_name,
  file_name,
  file_lines,
  options,
) {
  const checkout_arguments = options.create_branch
    ? ['checkout', '-b', branch_name]
    : ['checkout', branch_name];

  await execGitFile(checkout_arguments, {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await writeQueueFile(repo_directory, file_name, file_lines);
  await execGitFile(['add', file_name], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', `Update ${branch_name}`], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['checkout', 'main'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}

/**
 * @param {string} command
 * @param {'failure' | 'success'} end_state
 * @returns {string}
 */
function createQueueValidationFlowDocumentText(command, end_state) {
  const completion_lines =
    end_state === 'failure'
      ? ["    throw new Error('Queue validation requested failure.');"]
      : ['    return;'];

  return [
    "import { defineFlow, run } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and status == ready',",
    '  },',
    "  workspace: 'queue-validation',",
    '  async main(ctx) {',
    `    await run(ctx, { command: '${command}' });`,
    ...completion_lines,
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {string[]} branch_step_lines
 * @returns {string}
 */
function createQueueFlowModuleSource(branch_step_lines) {
  const handoff_branch = readQueueHandoffBranch(branch_step_lines);
  /** @type {string[]} */
  const import_names = ['defineFlow'];
  /** @type {string[]} */
  const main_lines = [];

  if (handoff_branch !== null) {
    import_names.push('queueHandoff');
    main_lines.push(
      '    await queueHandoff(ctx, {',
      `      branch: '${handoff_branch}',`,
      '    });',
    );
  } else {
    main_lines.push('    void ctx;');
  }

  return [
    `import { ${import_names.join(', ')} } from 'pravaha/flow';`,
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    "  workspace: 'app',",
    '  async main(ctx) {',
    ...main_lines,
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {string[]} branch_step_lines
 * @returns {string | null}
 */
function readQueueHandoffBranch(branch_step_lines) {
  for (const branch_step_line of branch_step_lines) {
    const branch_match = /^ {6}branch: (?<branch_name>[^\s].*)$/u.exec(
      branch_step_line,
    );

    if (branch_match?.groups?.branch_name !== undefined) {
      return branch_match.groups.branch_name;
    }
  }

  return null;
}

/**
 * @param {string} repo_directory
 * @returns {string}
 */
function getQueueGitDirectory(repo_directory) {
  return `${repo_directory}/.pravaha/queue.git`;
}
