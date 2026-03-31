import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { loadFlowDefinition } from './load-flow-definition.js';
import {
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';

it('rejects yaml flow definition files', async () => {
  await expect(loadFlowDefinition('/repo', 'flow.yaml')).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message:
          'Flow definition files must use .js or .mjs and default-export defineFlow(...). YAML flow documents are no longer supported.',
      },
    ],
    flow_definition: null,
    surface: null,
  });
});

it('loads a JavaScript flow module that default-exports defineFlow(...)', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-module-',
    {
      'docs/flows/runtime/test-flow.js': createFlowModuleSource({
        handler_lines: [
          '  async onApprove(ctx, data) {',
          '    void ctx;',
          '    void data;',
          '  },',
        ],
      }),
    },
  );

  try {
    await linkPravahaPackage(temp_directory);

    await expect(
      loadFlowDefinition(temp_directory, 'docs/flows/runtime/test-flow.js'),
    ).resolves.toMatchObject({
      diagnostics: [],
      flow_definition: {
        main: asMatcher(expect.any(Function)),
        on: {
          patram: '$class == task and status == ready',
        },
        onApprove: asMatcher(expect.any(Function)),
        workspace: {
          id: 'app',
        },
      },
      surface: 'javascript-module',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces JavaScript module load failures', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-flow-module-',
    {
      'docs/flows/runtime/test-flow.js': 'export default {};\n',
    },
  );

  try {
    await expect(
      loadFlowDefinition(temp_directory, 'docs/flows/runtime/test-flow.js'),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: 'docs/flows/runtime/test-flow.js',
          message:
            'Cannot load JavaScript flow module: Flow module "docs/flows/runtime/test-flow.js" must default-export defineFlow(...).',
        },
      ],
      flow_definition: null,
      surface: null,
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

/**
 * @param {{
 *   handler_lines?: string[],
 * }} [options]
 * @returns {string}
 */
function createFlowModuleSource(options = {}) {
  return [
    "import { defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    '    void ctx;',
    '  },',
    ...(options.handler_lines ?? []),
    '});',
    '',
  ].join('\n');
}
