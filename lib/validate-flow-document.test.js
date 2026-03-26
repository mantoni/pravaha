/* eslint-disable max-lines, max-lines-per-function */
import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
} from './plugin.fixture-test-helpers.js';
import { validateFlowDocument } from './validate-flow-document.js';

const SEMANTIC_MODEL = {
  semantic_role_names: new Set(['task', 'contract']),
  semantic_state_names: new Set(['blocked', 'ready', 'review']),
};

it('reports missing and duplicate YAML blocks', async () => {
  expect(
    await validateFlowDocument('# Flow\n', 'flow.md', SEMANTIC_MODEL),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Flow documents must contain exactly one fenced ```yaml``` block.',
    },
  ]);

  expect(
    await validateFlowDocument(
      ['```yaml', 'jobs: {}', '```', '```yaml', 'jobs: {}', '```', ''].join(
        '\n',
      ),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Flow documents must not contain more than one fenced ```yaml``` block.',
    },
  ]);
});

it('reports invalid YAML and invalid top-level flow shapes', async () => {
  expect(
    (
      await validateFlowDocument(
        ['```yaml', 'jobs: [', '```', ''].join('\n'),
        'flow.md',
        SEMANTIC_MODEL,
      )
    )[0].message,
  ).toContain('Invalid YAML flow definition:');

  expect(
    await validateFlowDocument(
      ['```yaml', '- not-an-object', '```', ''].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Flow YAML must evaluate to an object.',
    },
  ]);

  expect(
    await validateFlowDocument(
      ['```yaml', 'name: demo', '```', ''].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Flow YAML must define a top-level "jobs" mapping.',
    },
  ]);
});

it('skips semantic checks when no semantic model is provided', async () => {
  expect(
    await validateFlowDocument(
      ['```yaml', 'jobs:', '  build: {}', '```', ''].join('\n'),
      'flow.md',
      null,
    ),
  ).toEqual([]);
});

it('validates semantic references across nested flow nodes', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    select:',
        '      role: worker',
        '    steps:',
        '      - transition:',
        '          to: review',
        '      - relate:',
        '          from_role: task',
        '          to_role: [contract, ""]',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Unknown semantic role "worker" at flow.jobs.build.select.role.',
    },
    {
      file_path: 'flow.md',
      message:
        'Expected role reference at flow.jobs.build.steps[1].relate.to_role[1] to be a non-empty string.',
    },
  ]);
});

it('accepts job-level worktree policy and rejects invalid worktree shapes', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    worktree:',
        '      mode: named',
        '      slot: castello',
        '    steps: []',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([]);

  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    worktree:',
        '      mode: named',
        '    steps: []',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected flow.jobs.build.worktree.slot to be a non-empty string when mode is "named".',
    },
  ]);
});

it('rejects step-level worktree overrides', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    worktree:',
        '      mode: ephemeral',
        '    steps:',
        '      - uses: core/codex-sdk',
        '        worktree:',
        '          mode: named',
        '          slot: castello',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Step-level worktree overrides are not allowed at flow.jobs.build.steps[0].worktree.',
    },
  ]);
});

it('rejects select queries over reserved runtime classes and validates explicit transition states', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    select: $class == $signal',
        '    steps:',
        '      - if: $class == $signal and outcome == success',
        '        transition:',
        '          target: document',
        '          status: waiting',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Reserved runtime classes are not allowed in flow.jobs.build.select.',
    },
    {
      file_path: 'flow.md',
      message:
        'Unknown semantic state "waiting" at flow.jobs.build.steps[0].transition.status.',
    },
  ]);
});

it('validates executable query binding syntax in select, await, and if nodes', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  build:',
        '    select: $class == task and tracked_in == @document',
        '    steps:',
        '      - await: $class == $signal and tracked_in == @Task',
        '      - if: $class == $signal and tracked_in == @worker',
        '        transition:',
        '          target: task',
        '          status: review',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unsupported query binding "@Task". at flow.jobs.build.steps[0].await.',
    },
    {
      file_path: 'flow.md',
      message:
        'Missing query binding "worker". at flow.jobs.build.steps[1].if.',
    },
  ]);
});

it('validates job-level needs references', async () => {
  expect(
    await validateFlowDocument(
      [
        '```yaml',
        'jobs:',
        '  implement:',
        '    select:',
        '      role: task',
        '    steps: []',
        '  review:',
        '    needs: [missing_job]',
        '    steps:',
        '      - transition:',
        '          target: document',
        '          status: review',
        '```',
        '',
      ].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Unknown job "missing_job" at flow.jobs.review.needs[0].',
    },
  ]);
});

it('validates malformed needs arrays and earlier-job ordering', async () => {
  expect(await validateFlow(createEarlierNeedsFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected flow.jobs.review.needs[0] to reference an earlier declared job.',
    },
  ]);

  expect(await validateFlow(createNonArrayNeedsFlow())).toEqual([
    {
      file_path: 'flow.md',
      message: 'Expected flow.jobs.review.needs to be an array of job names.',
    },
  ]);
});

it('validates additional worktree policy failures', async () => {
  expect(await validateFlow(createNonObjectWorktreeFlow())).toEqual([
    {
      file_path: 'flow.md',
      message: 'Expected flow.jobs.build.worktree to be an object.',
    },
  ]);

  expect(await validateFlow(createUnsupportedWorktreeModeFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected flow.jobs.build.worktree.mode to be "ephemeral" or "named".',
    },
  ]);

  expect(await validateFlow(createEphemeralSlotFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Did not expect flow.jobs.build.worktree.slot when mode is "ephemeral".',
    },
  ]);
});

it('validates plugin with inputs against the declared schema', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/request-review.js': createPluginModuleSource({
        emits_source: '{ review_requested: z.object({ status: z.string() }) }',
        with_source: 'z.object({ reviewer: z.string() })',
      }),
    },
  });

  try {
    expect(
      await validateFlowDocument(
        [
          '```yaml',
          'jobs:',
          '  implement:',
          '    select:',
          '      role: task',
          '    worktree:',
          '      mode: ephemeral',
          '    steps:',
          '      - uses: local/request-review',
          '        with:',
          '          reviewer: alice',
          '      - await: review_requested',
          '      - if: $class == $signal and kind == review_requested',
          '        transition:',
          '          target: task',
          '          status: review',
          '      - if: $class == $signal and kind == review_failed',
          '        transition:',
          '          target: task',
          '          status: blocked',
          '```',
          '',
        ].join('\n'),
        'flow.md',
        SEMANTIC_MODEL,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([]);

    expect(
      await validateFlowDocument(
        [
          '```yaml',
          'jobs:',
          '  implement:',
          '    select:',
          '      role: task',
          '    worktree:',
          '      mode: ephemeral',
          '    steps:',
          '      - uses: local/request-review',
          '        with:',
          '          reviewer: 42',
          '      - await: review_requested',
          '      - if: $class == $signal and kind == review_requested',
          '        transition:',
          '          target: task',
          '          status: review',
          '      - if: $class == $signal and kind == review_failed',
          '        transition:',
          '          target: task',
          '          status: blocked',
          '```',
          '',
        ].join('\n'),
        'flow.md',
        SEMANTIC_MODEL,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([
      {
        file_path: 'flow.md',
        message:
          'Invalid plugin with value at flow.jobs.implement.steps[0].with: reviewer: Invalid input: expected string, received number',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects flow with values when the referenced plugin omits a with schema', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/emit-ready.js': createPluginModuleSource({
        emits_source: '{ ready_signal: z.object({ ok: z.boolean() }) }',
      }),
    },
  });

  try {
    expect(
      await validateFlowDocument(
        [
          '```yaml',
          'jobs:',
          '  implement:',
          '    select:',
          '      role: task',
          '    worktree:',
          '      mode: ephemeral',
          '    steps:',
          '      - uses: local/emit-ready',
          '        with:',
          '          ok: true',
          '      - await: ready_signal',
          '      - if: $class == $signal and kind == ready_signal',
          '        transition:',
          '          target: task',
          '          status: review',
          '      - if: $class == $signal and kind == ready_failed',
          '        transition:',
          '          target: task',
          '          status: blocked',
          '```',
          '',
        ].join('\n'),
        'flow.md',
        SEMANTIC_MODEL,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([
      {
        file_path: 'flow.md',
        message:
          'Did not expect with because plugin "local/emit-ready" does not declare a with schema. at flow.jobs.implement.steps[0].with.',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects await signal kinds that are not emitted by plugins referenced in the same flow', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/request-review.js': createPluginModuleSource({
        emits_source: '{ review_requested: z.object({ status: z.string() }) }',
      }),
    },
  });

  try {
    expect(
      await validateFlowDocument(
        [
          '```yaml',
          'jobs:',
          '  implement:',
          '    select:',
          '      role: task',
          '    worktree:',
          '      mode: ephemeral',
          '    steps:',
          '      - uses: local/request-review',
          '      - await: worker_completed',
          '      - if: $class == $signal and kind == worker_completed',
          '        transition:',
          '          target: task',
          '          status: review',
          '      - if: $class == $signal and kind == worker_failed',
          '        transition:',
          '          target: task',
          '          status: blocked',
          '```',
          '',
        ].join('\n'),
        'flow.md',
        SEMANTIC_MODEL,
        {
          repo_directory: temp_directory,
        },
      ),
    ).toEqual([
      {
        file_path: 'flow.md',
        message:
          'Unknown await signal kind "worker_completed" at flow.jobs.implement.steps[1].await.',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string[]} yaml_lines
 * @returns {ReturnType<typeof validateFlowDocument>}
 */
function validateFlow(yaml_lines) {
  return validateFlowDocument(yaml_lines.join('\n'), 'flow.md', SEMANTIC_MODEL);
}

/**
 * @returns {string[]}
 */
function createEarlierNeedsFlow() {
  return [
    '```yaml',
    'jobs:',
    '  review:',
    '    needs: [implement]',
    '    steps:',
    '      - transition:',
    '          target: document',
    '          status: review',
    '  implement:',
    '    select:',
    '      role: task',
    '    steps: []',
    '```',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createNonArrayNeedsFlow() {
  return [
    '```yaml',
    'jobs:',
    '  review:',
    '    needs: implement',
    '    steps: []',
    '```',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createNonObjectWorktreeFlow() {
  return [
    '```yaml',
    'jobs:',
    '  build:',
    '    worktree: named',
    '    steps: []',
    '```',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createUnsupportedWorktreeModeFlow() {
  return [
    '```yaml',
    'jobs:',
    '  build:',
    '    worktree:',
    '      mode: pooled',
    '    steps: []',
    '```',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createEphemeralSlotFlow() {
  return [
    '```yaml',
    'jobs:',
    '  build:',
    '    worktree:',
    '      mode: ephemeral',
    '      slot: castello',
    '    steps: []',
    '```',
    '',
  ];
}
