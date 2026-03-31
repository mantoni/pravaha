import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { validateFlowDocument } from './validate-flow-document.js';
import {
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';

it('rejects yaml flow documents', async () => {
  expect(
    await validateFlowDocument(
      ['jobs:', '  done:', '    end: success', ''].join('\n'),
      'flow.yaml',
      null,
    ),
  ).toEqual([
    {
      file_path: 'flow.yaml',
      message:
        'Flow definition files must use .js or .mjs and default-export defineFlow(...). YAML flow documents are no longer supported.',
    },
  ]);
});

it('accepts a valid JavaScript flow module with named re-entry handlers', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-validate-',
    {
      'docs/flows/runtime/test-flow.js': createFlowModuleSource({
        extra_lines: [
          '  async onApprove(ctx, data) {',
          '    void ctx;',
          '    void data;',
          '  },',
        ],
      }),
    },
  );
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.js',
  );

  try {
    await linkPravahaPackage(temp_directory);

    expect(
      await validateFlowDocument(
        await readFile(flow_file_path, 'utf8'),
        flow_file_path,
        null,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects JavaScript flow modules without main or with legacy graph fields', async () => {
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      extra_lines: ['  jobs: {},'],
      include_main: false,
    }),
    'JavaScript flow modules must define flow.main as a function.',
  );
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      extra_lines: ['  jobs: {},'],
    }),
    'Legacy field flow.jobs is no longer supported in JavaScript flow modules.',
  );
});

it('rejects malformed workspace and trigger declarations in JavaScript flow modules', async () => {
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      workspace_lines: ['  workspace: {', "    id: '',", '  },'],
    }),
    'Expected flow.workspace.id to be a non-empty string.',
  );
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      on_lines: ['  on: {', '    patram: [],', '  },'],
    }),
    'Expected flow.on.patram to be a string.',
  );
});

it('rejects missing or malformed flow.on declarations', async () => {
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      on_lines: [],
    }),
    'Expected flow.on.patram to be defined as a string.',
  );
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      on_lines: ["  on: 'ready',"],
    }),
    'Expected flow.on to be an object.',
  );
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      on_lines: [
        '  on: {',
        "    patram: '$class == task and status == ready',",
        "    task: '$class == task',",
        '  },',
      ],
    }),
    'Expected flow.on to define only flow.on.patram.',
  );
});

it('rejects malformed JavaScript flow workspaces', async () => {
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      workspace_lines: ["  workspace: 'app',"],
    }),
    'Expected flow.workspace to be an object for JavaScript flow modules.',
  );
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      workspace_lines: [
        '  workspace: {',
        "    id: 'app',",
        "    mode: 'ephemeral',",
        '  },',
      ],
    }),
    'Expected flow.workspace to declare only id. Move lifecycle, placement, and checkout semantics into pravaha.json workspaces.',
  );
});

it('validates JavaScript trigger query syntax without a Patram model', async () => {
  await expectFlowModuleDiagnostic(
    createFlowModuleSource({
      on_lines: ['  on: {', "    patram: '$class == task and',", '  },'],
    }),
    'Expected a query term. at flow.on.patram.',
  );
});

it('accepts trigger queries without an explicit owner class when the syntax is valid', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-validate-',
    {
      'docs/flows/runtime/test-flow.js': createFlowModuleSource({
        on_lines: ['  on: {', "    patram: 'status == ready',", '  },'],
      }),
    },
  );
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.js',
  );

  try {
    await linkPravahaPackage(temp_directory);

    expect(
      await validateFlowDocument(
        await readFile(flow_file_path, 'utf8'),
        flow_file_path,
        null,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('accepts trigger queries that constrain the owner class through a class list', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-validate-',
    {
      'docs/flows/runtime/test-flow.js': createFlowModuleSource({
        on_lines: [
          '  on: {',
          "    patram: '$class in [task] and status == ready',",
          '  },',
        ],
      }),
    },
  );
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.js',
  );

  try {
    await linkPravahaPackage(temp_directory);

    expect(
      await validateFlowDocument(
        await readFile(flow_file_path, 'utf8'),
        flow_file_path,
        null,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} flow_module_source
 * @param {string} message
 * @returns {Promise<void>}
 */
async function expectFlowModuleDiagnostic(flow_module_source, message) {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-validate-',
    {
      'docs/flows/runtime/test-flow.js': flow_module_source,
    },
  );
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.js',
  );

  try {
    await linkPravahaPackage(temp_directory);

    expect(
      await validateFlowDocument(flow_module_source, flow_file_path, null, {
        repo_directory: temp_directory,
      }),
    ).toContainEqual({
      file_path: flow_file_path,
      message,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @param {{
 *   extra_lines?: string[],
 *   include_main?: boolean,
 *   on_lines?: string[],
 *   workspace_lines?: string[],
 * }} [options]
 * @returns {string}
 */
function createFlowModuleSource(options = {}) {
  return [
    "import { defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    ...(options.on_lines ?? [
      '  on: {',
      "    patram: '$class == task and status == ready',",
      '  },',
    ]),
    ...(options.workspace_lines ?? [
      '  workspace: {',
      "    id: 'app',",
      '  },',
    ]),
    ...(options.include_main === false
      ? []
      : ['  async main(ctx) {', '    void ctx;', '  },']),
    ...(options.extra_lines ?? []),
    '});',
    '',
  ].join('\n');
}
