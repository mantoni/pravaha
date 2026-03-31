import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import patram_config from '../../.patram.json' with { type: 'json' };
import pravaha_config from '../../pravaha.json' with { type: 'json' };
import {
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';
import { validateRepo } from './validate-repo.js';

it('validates a fixture repo and reports the checked flow count', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      '.patram.json': `${JSON.stringify(patram_config, null, 2)}\n`,
      'pravaha.json': `${JSON.stringify(pravaha_config, null, 2)}\n`,
      'docs/flows/runtime/valid.js': createValidFlowModuleSource(),
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('validates checked-in JavaScript flow modules and counts them', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/valid.js': createValidFlowModuleSource(),
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

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
          message: asMatcher(
            expect.stringContaining('Cannot read flow directory:'),
          ),
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces flow diagnostics for invalid JavaScript flow modules', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/invalid.js': [
        "import { defineFlow } from 'pravaha';",
        '',
        'export default defineFlow({',
        '  on: {',
        "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler',",
        '  },',
        '  workspace: {',
        "    id: 'app',",
        '  },',
        '});',
        '',
      ].join('\n'),
      'pravaha.json': '{}\n',
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/invalid.js`,
          message:
            'JavaScript flow modules must define flow.main as a function.',
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
      'docs/flows/runtime/b-flow.js': createValidFlowModuleSource({
        trigger_where:
          '$class == task and tracked_in == contract:single-task-flow-reconciler',
      }),
      'docs/flows/runtime/a-flow.js': createValidFlowModuleSource({
        trigger_where:
          '$class == worker and tracked_in == contract:single-task-flow-reconciler',
      }),
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 2,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/a-flow.js`,
          message:
            'Unknown Patram class "worker" in trigger query. in flow.on.patram.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports flows whose workspace ids are missing from global workspace config', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/missing-workspace.js': createValidFlowModuleSource({
        trigger_where:
          '$class == task and tracked_in == contract:single-task-flow-reconciler',
        workspace_id: 'missing-app',
      }),
    },
    {
      pravaha_config_override: {
        workspaces: {},
      },
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/missing-workspace.js`,
          message:
            'Flow workspace.id "missing-app" is not defined in pravaha.json workspaces.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   trigger_where?: string,
 *   workspace_id?: string,
 * }} [options]
 * @returns {string}
 */
function createValidFlowModuleSource(options = {}) {
  return [
    "import { defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    `    patram: '${options.trigger_where ?? '$class == task and tracked_in == contract:single-task-flow-reconciler'}',`,
    '  },',
    '  workspace: {',
    `    id: '${options.workspace_id ?? 'app'}',`,
    '  },',
    '  async main(ctx) {',
    '    void ctx;',
    '  },',
    '});',
    '',
  ].join('\n');
}

it('rejects yaml files under docs/flows during repo validation', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-validate-repo-',
    {
      'docs/flows/runtime/legacy.yaml': ['jobs: {}', ''].join('\n'),
    },
  );

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [
        {
          file_path: `${temp_directory}/docs/flows/runtime/legacy.yaml`,
          message:
            'Flow definition files must use .js or .mjs and default-export defineFlow(...). YAML flow documents are no longer supported.',
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
    const validation_result = await validateRepo(temp_directory);

    expect(validation_result.checked_flow_count).toBe(0);
    expect(validation_result.diagnostics).toContainEqual({
      file_path: `${temp_directory}/.patram.json`,
      message: asMatcher(expect.stringContaining('Cannot load JSON file:')),
    });
    expect(validation_result.diagnostics).toContainEqual({
      file_path: `${temp_directory}/pravaha.json`,
      message: asMatcher(expect.stringContaining('Cannot load JSON file:')),
    });
    expect(validation_result.diagnostics).toContainEqual({
      file_path: `${temp_directory}/docs/flows`,
      message: asMatcher(
        expect.stringContaining('Cannot read flow directory:'),
      ),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
