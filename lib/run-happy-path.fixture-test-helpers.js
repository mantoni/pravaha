import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import patram_config from '../.patram.json' with { type: 'json' };
import pravaha_config from '../pravaha.json' with { type: 'json' };

const exec_file = promisify(execFile);

export {
  createFixtureDocument,
  createFixtureRepo,
  createFixtureRepoFromFiles,
  initializeGitRepository,
  replaceInFile,
};

/**
 * @returns {Promise<string>}
 */
async function createFixtureRepo() {
  return createFixtureRepoFromFiles(
    'pravaha-happy-path-',
    createFixtureFiles(),
  );
}

/**
 * @param {string} temp_prefix
 * @param {Record<string, string>} fixture_files
 * @returns {Promise<string>}
 */
async function createFixtureRepoFromFiles(temp_prefix, fixture_files) {
  const temp_directory = await mkdtemp(join(tmpdir(), temp_prefix));

  await writeFile(
    join(temp_directory, '.patram.json'),
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );
  await writeFile(
    join(temp_directory, 'pravaha.json'),
    `${JSON.stringify(pravaha_config, null, 2)}\n`,
  );

  for (const [relative_path, source_text] of Object.entries(fixture_files)) {
    const target_path = join(temp_directory, relative_path);

    await mkdir(dirname(target_path), { recursive: true });
    await writeFile(target_path, source_text);
  }

  await initializeGitRepository(temp_directory);

  return temp_directory;
}

/**
 * @param {string} file_path
 * @param {string} search_text
 * @param {string} replace_text
 * @returns {Promise<void>}
 */
async function replaceInFile(file_path, search_text, replace_text) {
  const source_text = await readFile(file_path, 'utf8');
  const updated_text = source_text.replace(search_text, replace_text);

  await writeFile(file_path, updated_text);
}

/**
 * @returns {Record<string, string>}
 */
function createFixtureFiles() {
  return {
    ...createContractFixtures(),
    ...createDecisionFixtures(),
    ...createFlowFixtures(),
    ...createTaskFixtures(),
    ...createPlanFixtures(),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createContractFixtures() {
  return {
    'docs/contracts/runtime/codex-sdk-happy-path.md': createFixtureDocument({
      body: '# Codex SDK Happy Path Contract\n',
      metadata: [
        ['Kind', 'contract'],
        ['Id', 'codex-sdk-happy-path'],
        ['Status', 'active'],
        [
          'Decided by',
          'docs/decisions/runtime/codex-sdk-happy-path-backend.md',
        ],
        ['Root flow', 'docs/flows/runtime/codex-sdk-happy-path.md'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createDecisionFixtures() {
  return {
    'docs/decisions/runtime/codex-sdk-happy-path-backend.md':
      createFixtureDocument({
        body: '# Codex SDK Happy Path Backend\n',
        metadata: [
          ['Kind', 'decision'],
          ['Id', 'codex-sdk-happy-path-backend'],
          ['Status', 'accepted'],
          ['Tracked in', 'docs/plans/repo/v0.1/pravaha-flow-runtime.md'],
        ],
      }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createFlowFixtures() {
  return {
    'docs/flows/runtime/codex-sdk-happy-path.md': createFixtureDocument({
      body: [
        '# Codex SDK Happy Path',
        '',
        '```yaml',
        'kind: flow',
        'id: codex-sdk-happy-path',
        'status: active',
        'scope: contract',
        '',
        'jobs:',
        '  run_first_ready_task:',
        '    select:',
        '      role: task',
        '    worktree:',
        '      mode: ephemeral',
        '    steps:',
        '      - uses: core/lease-task',
        '      - uses: core/setup-worktree',
        '      - uses: core/codex-sdk',
        '      - await:',
        '          $class == $signal and kind == worker_completed and subject == task',
        '      - if:',
        '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
        '        transition:',
        '          to: review',
        '      - if:',
        '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
        '        transition:',
        '          to: blocked',
        '```',
        '',
      ].join('\n'),
      metadata: [
        ['Kind', 'flow'],
        ['Id', 'codex-sdk-happy-path'],
        ['Status', 'active'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createTaskFixtures() {
  return {
    'docs/tasks/runtime/implement-runtime-slice.md': createFixtureDocument({
      body: '# Implement Runtime Slice\n',
      metadata: [
        ['Kind', 'task'],
        ['Id', 'implement-runtime-slice'],
        ['Status', 'ready'],
        ['Tracked in', 'docs/contracts/runtime/codex-sdk-happy-path.md'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createPlanFixtures() {
  return {
    'docs/plans/repo/v0.1/pravaha-flow-runtime.md': createFixtureDocument({
      body: '# Runtime Plan\n',
      metadata: [
        ['Kind', 'plan'],
        ['Id', 'pravaha-flow-runtime'],
        ['Status', 'active'],
      ],
    }),
  };
}

/**
 * @param {{ body: string, metadata: Array<[string, string]> }} options
 * @returns {string}
 */
function createFixtureDocument(options) {
  const metadata_lines = options.metadata.map(
    ([label, value]) => `${label}: ${value}`,
  );

  return `---\n${metadata_lines.join('\n')}\n---\n${options.body}`;
}

/**
 * @param {string} repo_directory
 * @returns {Promise<void>}
 */
async function initializeGitRepository(repo_directory) {
  await exec_file('git', ['init'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await exec_file('git', ['config', 'user.email', 'pravaha@example.com'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await exec_file('git', ['config', 'user.name', 'Pravaha Tests'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await exec_file('git', ['add', '.'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await exec_file('git', ['commit', '-m', 'Initial fixture'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}
