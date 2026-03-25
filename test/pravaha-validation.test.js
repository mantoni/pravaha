import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };
import pravaha_config from '../pravaha.json' with { type: 'json' };

import { validateRepo } from '../lib/pravaha.js';

it('validates flow semantic references against the repo config', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: [
      'jobs:',
      '  review-task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - transition:',
      '          to: review',
      '',
    ].join('\n'),
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports unknown semantic roles and states in flow documents', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: [
      'jobs:',
      '  lease-task:',
      '    select:',
      '      role: worker',
      '    steps:',
      '      - transition: waiting',
      '',
    ].join('\n'),
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.md',
    );

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toEqual([
      {
        file_path: flow_file_path,
        message:
          'Unknown semantic role "worker" at flow.jobs.lease-task.select.role.',
      },
      {
        file_path: flow_file_path,
        message:
          'Unknown semantic state "waiting" at flow.jobs.lease-task.steps[0].transition.',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports invalid semantic-state mappings in pravaha.json', async () => {
  const temp_directory = await createFixtureRepo({
    pravaha_config_override: {
      semantic_roles: pravaha_config.semantic_roles,
      semantic_states: {
        review: ['review'],
        terminal: ['not-a-status'],
      },
    },
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const pravaha_config_path = join(temp_directory, 'pravaha.json');

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toEqual([
      {
        file_path: pravaha_config_path,
        message:
          'semantic state "terminal" references unknown target "not-a-status".',
      },
      {
        file_path: pravaha_config_path,
        message: 'Missing required semantic state "ready".',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   flow_yaml?: string,
 *   pravaha_config_override?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createFixtureRepo(options = {}) {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-validation-'));
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.md',
  );
  const patram_config_path = join(temp_directory, '.patram.json');
  const pravaha_config_path = join(temp_directory, 'pravaha.json');
  const flow_yaml = options.flow_yaml ?? createDefaultFlowYaml();
  const effective_pravaha_config =
    options.pravaha_config_override ?? pravaha_config;

  await mkdir(dirname(flow_file_path), { recursive: true });
  await writeFile(
    patram_config_path,
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );
  await writeFile(
    pravaha_config_path,
    `${JSON.stringify(effective_pravaha_config, null, 2)}\n`,
  );
  await writeFile(flow_file_path, createFlowDocument(flow_yaml));

  return temp_directory;
}

/**
 * @param {string} flow_yaml
 * @returns {string}
 */
function createFlowDocument(flow_yaml) {
  return [
    '---',
    'Kind: flow',
    'Id: test-flow',
    'Status: active',
    '---',
    '',
    '# Test Flow',
    '',
    '```yaml',
    flow_yaml.trimEnd(),
    '```',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createDefaultFlowYaml() {
  return [
    'jobs:',
    '  smoke:',
    '    steps:',
    '      - run: npm run all',
    '',
  ].join('\n');
}
