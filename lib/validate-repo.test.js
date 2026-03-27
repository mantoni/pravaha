import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };
import pravaha_config from '../pravaha.json' with { type: 'json' };
import { createFixtureRepoFromFiles } from './run-happy-path.fixture-test-helpers.js';
import { validateRepo } from './validate-repo.js';

it('validates a fixture repo and reports the checked flow count', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      '.patram.json': `${JSON.stringify(patram_config, null, 2)}\n`,
      'pravaha.json': `${JSON.stringify(pravaha_config, null, 2)}\n`,
      'docs/flows/runtime/valid.md': [
        '# Valid Flow',
        '',
        '```yaml',
        'workspace:',
        '  type: git.workspace',
        '  source:',
        '    kind: repo',
        '    id: app',
        '  materialize:',
        '    kind: worktree',
        '    mode: ephemeral',
        '    ref: main',
        'on:',
        '  task:',
        '    where: $class == task and tracked_in == @document',
        'jobs:',
        '  validate:',
        '    uses: core/run',
        '    with:',
        '      command: npm test',
        '    next: done',
        '  done:',
        '    end: success',
        '```',
        '',
      ].join('\n'),
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces flow-directory diagnostics when no checked-in flows exist', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {},
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 0,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows`,
          message: expect.stringContaining('Cannot read flow directory:'),
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces config diagnostics when semantic mappings are missing', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/invalid.md': [
        '# Invalid Flow',
        '',
        '```yaml',
        'kind: flow',
        '```',
        '',
      ].join('\n'),
      'pravaha.json': '{}\n',
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [
        {
          file_path: `${temp_directory}/pravaha.json`,
          message:
            'Pravaha config must define object-valued semantic_roles and semantic_states mappings.',
        },
        {
          file_path: `${temp_directory}/docs/flows/runtime/invalid.md`,
          message: 'Flow YAML must define a top-level "jobs" mapping.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('validates every checked-in flow document in sorted order', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/b-flow.md': createValidStateMachineFlowMarkdown({
        trigger_binding: 'task',
        trigger_where: '$class == task and tracked_in == @document',
        job_name: 'second',
      }),
      'docs/flows/runtime/a-flow.md': createValidStateMachineFlowMarkdown({
        trigger_binding: 'first',
        trigger_where: '$class == worker and tracked_in == @document',
        job_name: 'first',
      }),
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 2,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/a-flow.md`,
          message:
            'Unknown semantic role "worker" in select query. in flow.on.first.where.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowDocumentMarkdown(yaml_lines) {
  return ['# Flow', '', '```yaml', ...yaml_lines, '```', ''].join('\n');
}

/**
 * @param {{
 *   trigger_binding: string,
 *   trigger_where: string,
 *   job_name: string,
 * }} options
 * @returns {string}
 */
function createValidStateMachineFlowMarkdown(options) {
  return createFlowDocumentMarkdown([
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    'on:',
    `  ${options.trigger_binding}:`,
    `    where: ${options.trigger_where}`,
    'jobs:',
    `  ${options.job_name}:`,
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '    next: done',
    '  done:',
    '    end: success',
  ]);
}

it('surfaces json load diagnostics for invalid repo config files', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      '.patram.json': '{broken\n',
      'pravaha.json': '{still-broken\n',
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 0,
      diagnostics: [
        {
          file_path: `${temp_directory}/.patram.json`,
          message: expect.stringContaining('Cannot load JSON file:'),
        },
        {
          file_path: `${temp_directory}/pravaha.json`,
          message: expect.stringContaining('Cannot load JSON file:'),
        },
        {
          file_path: `${temp_directory}/docs/flows`,
          message: expect.stringContaining('Cannot read flow directory:'),
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
