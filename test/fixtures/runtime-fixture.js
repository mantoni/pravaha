import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

import patram_config from '../../.patram.json' with { type: 'json' };
import pravaha_config from '../../pravaha.json' with { type: 'json' };
import { execGitFile } from '../../lib/shared/git/exec-git-file.js';

export {
  createFixtureDocument,
  createFixtureRepo,
  createFixtureRepoFromFiles,
  linkPravahaPackage,
};

const REPO_DIRECTORY = dirname(
  fileURLToPath(new URL('../../package.json', import.meta.url)),
);

/**
 * @returns {Promise<string>}
 */
async function createFixtureRepo() {
  return createFixtureRepoFromFiles('pravaha-runtime-', createFixtureFiles());
}

/**
 * @param {string} temp_prefix
 * @param {Record<string, string>} fixture_files
 * @param {{
 *   pravaha_config_override?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createFixtureRepoFromFiles(
  temp_prefix,
  fixture_files,
  options = {},
) {
  const temp_directory = await mkdtemp(join(tmpdir(), temp_prefix));
  const effective_pravaha_config = options.pravaha_config_override
    ? {
        ...pravaha_config,
        ...options.pravaha_config_override,
      }
    : pravaha_config;

  await writeFile(
    join(temp_directory, '.patram.json'),
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );
  await writeFile(
    join(temp_directory, 'pravaha.json'),
    `${JSON.stringify(effective_pravaha_config, null, 2)}\n`,
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
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function linkPravahaPackage(temp_directory) {
  await linkDirectory(
    REPO_DIRECTORY,
    join(temp_directory, 'node_modules', 'pravaha'),
  );
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
    'docs/flows/runtime/single-task-flow-reconciler.js':
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
    "import { defineFlow, run, runCodex } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    '    await run(ctx, {',
    "      command: 'true',",
    '    });',
    '    await runCodex(ctx, {',
    "      prompt: `Implement ${ctx.bindings.doc?.path ?? 'unknown'}.`,",
    "      reasoning: 'medium',",
    '    });',
    '    await run(ctx, {',
    '      command: "printf \'\'",',
    '    });',
    '  },',
    '});',
    '',
  ].join('\n');
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

/**
 * @param {string} target_directory
 * @param {string} link_path
 * @returns {Promise<void>}
 */
async function linkDirectory(target_directory, link_path) {
  await mkdir(dirname(link_path), { recursive: true });

  try {
    await symlink(target_directory, link_path, 'dir');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error;
    }
  }
}
