// @module-tag smoke
// @module-tag lint-staged-excluded

import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

it('installs and imports the packed npm package in a consumer project', async () => {
  const temp_directory = await createTempDirectory();

  try {
    const tarball_path = await packRepo(temp_directory);
    const consumer_directory = join(temp_directory, 'consumer');

    await createConsumerProject(consumer_directory);
    await installTarball(consumer_directory, tarball_path);
    await assertTarballIncludesDeclarations(tarball_path);
    await importPackedLibrary(consumer_directory);
    await importPackedConfigLibrary(consumer_directory);
    await importPackedFlowLibrary(consumer_directory);
    await importPackedCli(consumer_directory);
    await typecheckPackedLibrary(consumer_directory);
    await assertGeneratedDeclarationsAreCleared();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} parent_directory
 * @returns {Promise<string>}
 */
async function packRepo(parent_directory) {
  const npm_cache_directory = join(parent_directory, 'npm-cache');

  await mkdir(npm_cache_directory, { recursive: true });

  const { stdout } = await runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', parent_directory],
    repo_directory,
    {
      HUSKY: '0',
      npm_config_cache: npm_cache_directory,
    },
  );
  const pack_result = parsePackResult(stdout);

  return join(parent_directory, pack_result.filename);
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function createConsumerProject(consumer_directory) {
  await mkdir(consumer_directory, { recursive: true });

  await writeFile(
    join(consumer_directory, 'package.json'),
    createConsumerPackageJsonText(),
  );
  await writeFile(
    join(consumer_directory, 'index.ts'),
    createConsumerIndexText(),
  );
  await writeFile(
    join(consumer_directory, 'tsconfig.json'),
    createConsumerTsconfigText(),
  );
}

/**
 * @param {string} consumer_directory
 * @param {string} tarball_path
 * @returns {Promise<void>}
 */
async function installTarball(consumer_directory, tarball_path) {
  const npm_cache_directory = join(consumer_directory, '.npm-cache');

  await mkdir(npm_cache_directory, { recursive: true });

  await runCommand(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', tarball_path],
    consumer_directory,
    {
      npm_config_cache: npm_cache_directory,
    },
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedCli(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      "await import('./node_modules/pravaha/bin/pravaha.js')",
    ],
    consumer_directory,
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedLibrary(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      [
        "const package_module = await import('pravaha');",
        "if ('defineConfig' in package_module) {",
        "  throw new Error('Did not expect defineConfig export.');",
        '}',
        "if (typeof package_module.defineFlow !== 'function') {",
        "  throw new Error('Expected defineFlow export.');",
        '}',
        "if (typeof package_module.definePlugin !== 'function') {",
        "  throw new Error('Expected definePlugin export.');",
        '}',
        "if (typeof package_module.validateRepo !== 'function') {",
        "  throw new Error('Expected validateRepo export.');",
        '}',
      ].join('\n'),
    ],
    consumer_directory,
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedConfigLibrary(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      [
        "const config_module = await import('pravaha/config');",
        "if (typeof config_module.defineConfig !== 'function') {",
        "  throw new Error('Expected defineConfig export.');",
        '}',
      ].join('\n'),
    ],
    consumer_directory,
  );
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function importPackedFlowLibrary(consumer_directory) {
  await runCommand(
    'node',
    [
      '--input-type=module',
      '--eval',
      [
        "const flow_module = await import('pravaha/flow');",
        "if (typeof flow_module.defineFlow !== 'function') {",
        "  throw new Error('Expected defineFlow export.');",
        '}',
        "if (typeof flow_module.approve !== 'function') {",
        "  throw new Error('Expected approve export.');",
        '}',
      ].join('\n'),
    ],
    consumer_directory,
  );
}

/**
 * @param {string} tarball_path
 * @returns {Promise<void>}
 */
async function assertTarballIncludesDeclarations(tarball_path) {
  const { stdout } = await runCommand(
    'tar',
    ['-tf', tarball_path],
    repo_directory,
  );

  expect(stdout).toContain('package/lib/pravaha.d.ts');
  expect(stdout).toContain('package/lib/config.d.ts');
  expect(stdout).toContain('package/lib/flow.d.ts');
  expect(stdout).toContain('package/lib/flow/flow-contract.d.ts');
  expect(stdout).toContain('package/lib/plugins/plugin-contract.d.ts');
  expect(stdout).not.toContain('package/lib/pravaha.test.d.ts');
  expect(stdout).not.toContain('package/lib/flow/flow-contract.test.d.ts');
}

/**
 * @param {string} consumer_directory
 * @returns {Promise<void>}
 */
async function typecheckPackedLibrary(consumer_directory) {
  await runCommand(
    'node',
    [join(repo_directory, 'node_modules/typescript/bin/tsc'), '-p', '.'],
    consumer_directory,
  );
}

/**
 * @returns {Promise<void>}
 */
async function assertGeneratedDeclarationsAreCleared() {
  await expect(
    access(join(repo_directory, 'lib/pravaha.d.ts')),
  ).rejects.toThrow();
  await expect(
    access(join(repo_directory, 'lib/config.d.ts')),
  ).rejects.toThrow();
  await expect(access(join(repo_directory, 'lib/flow.d.ts'))).rejects.toThrow();
  await expect(
    access(join(repo_directory, 'lib/flow/flow-contract.d.ts')),
  ).rejects.toThrow();
  await expect(
    access(join(repo_directory, 'lib/plugins/plugin-contract.d.ts')),
  ).rejects.toThrow();
}

/**
 * @returns {Promise<string>}
 */
async function createTempDirectory() {
  return mkdtemp(join(tmpdir(), 'pravaha-package-install-'));
}

/**
 * @param {string} pack_result_text
 * @returns {{ filename: string }}
 */
function parsePackResult(pack_result_text) {
  const json_start = pack_result_text.indexOf('[');

  if (json_start < 0) {
    throw new Error(`Expected npm pack JSON output.\n${pack_result_text}`);
  }

  const json_text = pack_result_text.slice(json_start).trim();
  const json_end = json_text.lastIndexOf(']');

  if (json_end < 0) {
    throw new Error(`Expected npm pack JSON array.\n${pack_result_text}`);
  }

  const parsed_value = /** @type {unknown} */ (
    JSON.parse(json_text.slice(0, json_end + 1))
  );

  if (!Array.isArray(parsed_value) || parsed_value.length === 0) {
    throw new Error('Expected npm pack to return at least one result.');
  }

  /** @type {unknown[]} */
  const parsed_results = parsed_value;
  const [first_result] = parsed_results;

  if (
    first_result === null ||
    typeof first_result !== 'object' ||
    Array.isArray(first_result)
  ) {
    throw new Error('Expected npm pack to return a filename.');
  }

  const pack_result = /** @type {{ filename?: unknown }} */ (first_result);

  if (typeof pack_result.filename !== 'string') {
    throw new Error('Expected npm pack to return a filename.');
  }

  return /** @type {{ filename: string }} */ (pack_result);
}

/**
 * @returns {string}
 */
function createConsumerPackageJsonText() {
  return `${JSON.stringify(
    {
      name: 'pravaha-smoke-test-consumer',
      private: true,
      type: 'module',
    },
    null,
    2,
  )}\n`;
}

/**
 * @returns {string}
 */
function createConsumerIndexText() {
  return [
    createConsumerPravahaImportText(),
    '',
    createConsumerConfigImportText(),
    '',
    createConsumerFlowImportText(),
    '',
    createConsumerBindingText(),
    '',
    createConsumerConfigText(),
    '',
    createConsumerFlowText(),
    '',
    createConsumerPluginText(),
    '',
    'void flow_module;',
    'void plugin;',
    'void queue_wait;',
    'void dispatch_options;',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerPravahaImportText() {
  return [
    'import {',
    '  defineFlow,',
    '  definePlugin,',
    '  type DispatchFlowOptions,',
    '  type FlowBindingTarget,',
    '  type PluginContext,',
    '  type QueueWaitState,',
    '  type TaskFlowContext,',
    "} from 'pravaha';",
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerConfigImportText() {
  return "import { defineConfig } from 'pravaha/config';";
}

/**
 * @returns {string}
 */
function createConsumerFlowImportText() {
  return [
    'import {',
    '  approve,',
    '  defineFlow as defineFlowFromSubpath,',
    '  type FlowDefinition,',
    "} from 'pravaha/flow';",
    '',
    'const flow_module = approve;',
    'void defineFlowFromSubpath;',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerBindingText() {
  return [
    "const doc: FlowBindingTarget = { id: 'doc:contract', path: 'docs/contracts/example.md', status: 'active' };",
    "const task: FlowBindingTarget = { id: 'task:example', path: 'docs/tasks/example.md', status: 'ready' };",
    '',
    'const queue_wait: QueueWaitState = {',
    "  branch_head: 'abc123',",
    "  branch_ref: 'refs/heads/example',",
    '  outcome: null,',
    "  ready_ref: 'refs/heads/ready/example',",
    "  state: 'waiting',",
    '};',
    '',
    "const dispatch_options: DispatchFlowOptions = { flow: 'implement-task', wait: true };",
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerConfigText() {
  return [
    'const config = defineConfig({',
    "  flows: ['flows/implement-task.js'],",
    '  workspaces: {',
    '    app: {',
    "      mode: 'pooled',",
    "      paths: ['.pravaha/worktrees/app'],",
    "      ref: 'main',",
    '      source: {',
    "        kind: 'repo',",
    '      },',
    '    },',
    '  },',
    '});',
    'void config;',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerFlowText() {
  return [
    'type ExampleFlowContext = TaskFlowContext<',
    '  { approved: boolean },',
    '  { doc: FlowBindingTarget; task: FlowBindingTarget }',
    '>;',
    '',
    'const flow_definition: FlowDefinition<ExampleFlowContext, { approved: boolean }> = defineFlow({',
    '  on: {',
    "    patram: '$class == task and status == ready',",
    '  },',
    "  workspace: 'app',",
    '  async main(context) {',
    '    context.console.info(context.task.path);',
    '    await context.setState({ approved: false });',
    '  },',
    '  async onApprove(context, data) {',
    '    if (data.approved) {',
    '      context.console.info(context.doc.id);',
    '    }',
    '  },',
    '});',
    '',
    'const subpath_flow = defineFlowFromSubpath({',
    '  on: {',
    "    patram: '$class == task and status == ready',",
    '  },',
    "  workspace: 'app',",
    '  async main(context) {',
    '    context.console.info(context.task_id);',
    '  },',
    '});',
    'void flow_definition;',
    'void subpath_flow;',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerPluginText() {
  return [
    'const plugin = definePlugin({',
    '  async run(context: PluginContext<{ prompt: string }>) {',
    '    const typed_context: PluginContext<{ prompt: string }> = context;',
    '    typed_context.console.info(typed_context.with.prompt);',
    '    return typed_context.with.prompt;',
    '  },',
    '});',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createConsumerTsconfigText() {
  return `${JSON.stringify(
    {
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        strict: true,
        target: 'ES2023',
        typeRoots: [
          './node_modules/@types',
          join(repo_directory, 'node_modules/@types'),
        ],
        types: ['node'],
      },
      include: ['index.ts'],
    },
    null,
    2,
  )}\n`;
}

/**
 * @param {string} command
 * @param {string[]} command_arguments
 * @param {string} working_directory
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runCommand(
  command,
  command_arguments,
  working_directory,
  environment,
) {
  return execFileAsync(command, command_arguments, {
    cwd: working_directory,
    env: {
      ...process.env,
      ...environment,
    },
  });
}
