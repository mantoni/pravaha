import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createFixtureRepo,
  createFixtureRepoFromFiles,
} from './run-happy-path.fixture-test-helpers.js';
import { validateRepo } from './validate-repo.js';

it('validates a fixture repo and reports the checked flow count', async () => {
  const temp_directory = await createFixtureRepo();

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
      'docs/flows/runtime/b-flow.md': [
        '# Valid Flow',
        '',
        '```yaml',
        'jobs:',
        '  second:',
        '    steps: []',
        '```',
        '',
      ].join('\n'),
      'docs/flows/runtime/a-flow.md': [
        '# Invalid Flow',
        '',
        '```yaml',
        'jobs:',
        '  first:',
        '    select:',
        '      role: worker',
        '    steps: []',
        '```',
        '',
      ].join('\n'),
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 2,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/a-flow.md`,
          message:
            'Unknown semantic role "worker" at flow.jobs.first.select.role.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

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
