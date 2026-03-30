import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { validateFlowDocument } from './validate-flow-document.js';
import {
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../test/fixtures/runtime-fixture.js';

it('accepts a valid state-machine flow document', async () => {
  expect(await validateFlow(createValidFlow())).toEqual([]);
});

it('accepts state-machine jobs that still define select', async () => {
  expect(
    await validateFlow(
      createValidFlow().replace(
        '    uses: core/run-codex',
        [
          '    select: $class == task and status == ready',
          '    uses: core/run-codex',
        ].join('\n'),
      ),
    ),
  ).toEqual([]);
});

it('fails fast on removed legacy flow fields', async () => {
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    steps: []'),
    'Legacy field flow.jobs.implement.steps is no longer supported. Rewrite this job as a single uses/end node with next branching.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    needs: [done]'),
    'Legacy field flow.jobs.implement.needs is no longer supported. Rewrite this job as a single uses/end node with next branching.',
  );
  await expectDiagnostic(
    createValidFlow().replace('workspace:', '# workspace:'),
    'Legacy step-based flows are no longer supported. Add flow.workspace and rewrite jobs as state-machine nodes with uses/end plus next.',
  );
});

it('rejects unexpected state-machine job fields generically', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    await: nope', '    next: done'].join('\n'),
    ),
    'Did not expect flow.jobs.implement.await on a state-machine action job.',
  );
});

it('rejects invalid state-machine workspace and next shapes', async () => {
  await expectDiagnostic(
    createValidFlow().replace('  id: app', '  id: ""'),
    'Expected flow.workspace.id to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    next: missing'),
    'Unknown next target "missing" at flow.jobs.implement.next.',
  );
});

it('rejects malformed workspace declarations', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '  id: app',
      ['  id: app', '  type: git.workspace'].join('\n'),
    ),
    'Expected flow.workspace to declare only id. Move lifecycle, placement, and checkout semantics into pravaha.json workspaces.',
  );
  await expectDiagnostic(
    createValidFlow()
      .replace(
        '  id: app',
        ['  id: app', '  materialize:', '    mode: ephemeral'].join('\n'),
      )
      .replace('\njobs:', '\njobs:'),
    'Expected flow.workspace to declare only id. Move lifecycle, placement, and checkout semantics into pravaha.json workspaces.',
  );
});

it('rejects malformed trigger bindings and malformed next branches', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '  patram: $class == task and status == ready',
      '  document: $class == task and status == ready',
    ),
    'Expected flow.on to define only flow.on.patram.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  patram: $class == task and status == ready',
      '  patram: [ready]',
    ),
    'Expected flow.on.patram to be a string.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    next: []'),
    'Expected flow.jobs.implement.next to be a non-empty string target or a non-empty branch list.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: done', '      - goto: done'].join('\n'),
    ),
    'Only the final flow.jobs.implement.next branch may omit if.',
  );
});

it('rejects malformed limits and missing trigger definitions', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits:', '      nope: 1', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits.max-visits to be defined.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      ['on:', '  patram: $class == task and status == ready'].join('\n'),
      '',
    ),
    'Expected flow.on.patram to be defined as a string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      ['on:', '  patram: $class == task and status == ready'].join('\n'),
      'on: ready',
    ),
    'Expected flow.on to be an object.',
  );
});

it('rejects malformed state-machine job definitions and terminal-job misuse', async () => {
  await expectDiagnostic(
    createValidFlow().replace('    uses: core/run-codex', '    uses:'),
    'Expected flow.jobs.implement.uses to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  done:\n    end: success',
      ['  done:', '    end: success', '    next: implement'].join('\n'),
    ),
    'Did not expect flow.jobs.done.next on a terminal end job.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  done:\n    end: success',
      ['  done:', '    end:', '      status: success'].join('\n'),
    ),
    'Expected flow.jobs.done.end to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  implement:',
      ['  inspect:', '    with: {}', '  implement:'].join('\n'),
    ),
    'Expected flow.jobs.inspect to define a supported state-machine job.',
  );
});

it('rejects malformed next branches and invalid visit limits', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - done'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0] to be an object.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: ""'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0].goto to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - if: ""', '        goto: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0].if to be a non-empty string when present.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: missing'].join('\n'),
    ),
    'Unknown next target "missing" at flow.jobs.implement.next[0].goto.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits:', '      max-visits: 0', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits.max-visits to be a positive integer.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits: nope', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits to be an object.',
  );
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

/**
 * @param {string} flow_document_text
 * @returns {Promise<Awaited<ReturnType<typeof validateFlowDocument>>>}
 */
function validateFlow(flow_document_text) {
  return validateFlowDocument(flow_document_text, 'flow.yaml', null);
}

/**
 * @param {string} flow_document_text
 * @param {string} message
 * @returns {Promise<void>}
 */
async function expectDiagnostic(flow_document_text, message) {
  expect(await validateFlow(flow_document_text)).toContainEqual({
    file_path: 'flow.yaml',
    message,
  });
}

/**
 * @returns {string}
 */
function createValidFlow() {
  return [
    'on:',
    '  patram: $class == task and status == ready',
    'workspace:',
    '  id: app',
    'jobs:',
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Implement it.',
    '      reasoning: medium',
    '    next: done',
    '  done:',
    '    end: success',
    '',
  ].join('\n');
}

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
 * }} [options]
 * @returns {string}
 */
function createFlowModuleSource(options = {}) {
  const main_lines =
    options.include_main === false
      ? []
      : ['  async main(ctx) {', '    void ctx;', '  },'];

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
    ...main_lines,
    ...(options.extra_lines ?? []),
    '});',
    '',
  ].join('\n');
}
