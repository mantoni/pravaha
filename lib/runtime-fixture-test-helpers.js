import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import patram_config from '../.patram.json' with { type: 'json' };
import pravaha_config from '../pravaha.json' with { type: 'json' };
import { execGitFile } from './shared/git/exec-git-file.js';

export {
  createFixtureDocument,
  createFixtureRepo,
  createFixtureRepoFromFiles,
  initializeGitRepository,
};

/**
 * @returns {Promise<string>}
 */
async function createFixtureRepo() {
  return createFixtureRepoFromFiles('pravaha-runtime-', createFixtureFiles());
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
    'docs/contracts/runtime/single-task-flow-reconciler.md':
      createFixtureDocument({
        body: '# Single-Task Flow Reconciler\n',
        metadata: [
          ['Kind', 'contract'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'active'],
          [
            'Decided by',
            'docs/decisions/runtime/trigger-driven-codex-runtime.md',
          ],
          ['Root flow', 'docs/flows/runtime/single-task-flow-reconciler.yaml'],
        ],
      }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createDecisionFixtures() {
  return {
    'docs/decisions/runtime/trigger-driven-codex-runtime.md':
      createFixtureDocument({
        body: '# Trigger-Driven Codex Runtime\n',
        metadata: [
          ['Kind', 'decision'],
          ['Id', 'trigger-driven-codex-runtime'],
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
    'docs/flows/runtime/single-task-flow-reconciler.yaml':
      createRuntimeFlowSource(),
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
        ['Tracked in', 'docs/contracts/runtime/single-task-flow-reconciler.md'],
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
 * @returns {string}
 */
function createRuntimeFlowSource() {
  return [
    'kind: flow',
    'id: single-task-flow-reconciler',
    'status: active',
    'scope: contract',
    '',
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    '',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    '',
    ...createRuntimeJobLines(),
    '',
  ].join('\n');
}

/**
 * @returns {string[]}
 */
function createRuntimeJobLines() {
  return [
    'jobs:',
    '  prepare_workspace:',
    '    uses: core/run',
    '    with:',
    '      command: "true"',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: implement_task',
    '      - goto: failed',
    '',
    '  implement_task:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement ${{ task.path }}.',
    '    next:',
    '      - if: ${{ result.outcome == "success" }}',
    '        goto: finalize_workspace',
    '      - goto: failed',
    '',
    '  finalize_workspace:',
    '    uses: core/run',
    '    with:',
    '      command: "printf \'\'"',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: failed',
    '',
    '  done:',
    '    end: success',
    '',
    '  failed:',
    '    end: failure',
  ];
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
  await execGitFile(['init', '--initial-branch=main'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['config', 'user.email', 'pravaha@example.com'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['config', 'user.name', 'Pravaha Tests'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['add', '.'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
  await execGitFile(['commit', '-m', 'Initial fixture'], {
    cwd: repo_directory,
    encoding: 'utf8',
  });
}
