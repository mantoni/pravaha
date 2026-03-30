import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { loadFlowDefinition } from './load-flow-definition.js';
import {
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';

it('parses a native yaml flow definition', async () => {
  await expect(
    loadYamlFlowDefinition(
      [
        'jobs:',
        '  demo:',
        '    uses: core/run',
        '    next: done',
        '  done:',
        '    end: success',
        '',
      ].join('\n'),
    ),
  ).resolves.toEqual({
    diagnostics: [],
    flow_definition: {
      jobs: {
        demo: {
          next: 'done',
          uses: 'core/run',
        },
        done: {
          end: 'success',
        },
      },
    },
    surface: 'state-machine',
  });
});

it('rejects empty and multi-document yaml sources', async () => {
  await expect(loadYamlFlowDefinition('')).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow documents must contain exactly one YAML document.',
      },
    ],
    flow_definition: null,
    surface: null,
  });

  await expect(
    loadYamlFlowDefinition(['jobs: {}', '---', 'jobs: {}', ''].join('\n')),
  ).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow documents must contain exactly one YAML document.',
      },
    ],
    flow_definition: null,
    surface: null,
  });
});

it('rejects invalid yaml and invalid top-level flow shapes', async () => {
  await expect(
    loadYamlFlowDefinition(['jobs: [', ''].join('\n')),
  ).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: asMatcher(
          expect.stringContaining('Invalid YAML flow definition:'),
        ),
      },
    ],
    flow_definition: null,
    surface: null,
  });

  await expect(
    loadYamlFlowDefinition(['- task', ''].join('\n')),
  ).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow YAML must evaluate to an object.',
      },
    ],
    flow_definition: null,
    surface: null,
  });

  await expect(
    loadYamlFlowDefinition(['workspace: {}', ''].join('\n')),
  ).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow YAML must define a top-level "jobs" mapping.',
      },
    ],
    flow_definition: null,
    surface: null,
  });
});

it('accepts CRLF yaml sources', async () => {
  await expect(
    loadYamlFlowDefinition(['jobs:', '  demo: null', ''].join('\r\n')),
  ).resolves.toEqual({
    diagnostics: [],
    flow_definition: {
      jobs: {
        demo: null,
      },
    },
    surface: 'state-machine',
  });
});

it('preserves multiple yaml parser diagnostics', async () => {
  await expect(
    loadYamlFlowDefinition(
      [
        'jobs:',
        '  demo:',
        '    next:',
        '      - goto: [',
        '      - goto: [',
        '',
      ].join('\n'),
    ),
  ).resolves.toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: asMatcher(
          expect.stringContaining('Invalid YAML flow definition:'),
        ),
      },
      {
        file_path: 'flow.yaml',
        message: asMatcher(
          expect.stringContaining('Invalid YAML flow definition:'),
        ),
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

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}

/**
 * @param {string} flow_document_text
 * @returns {Promise<Awaited<ReturnType<typeof loadFlowDefinition>>>}
 */
function loadYamlFlowDefinition(flow_document_text) {
  return loadFlowDefinition('/repo', 'flow.yaml', flow_document_text);
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
