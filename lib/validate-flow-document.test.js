import { expect, it } from 'vitest';

import { validateFlowDocument } from './validate-flow-document.js';

const SEMANTIC_MODEL = {
  semantic_role_names: new Set(['task', 'contract']),
  semantic_state_names: new Set(['blocked', 'ready', 'review']),
};

it('reports missing and duplicate YAML blocks', () => {
  expect(validateFlowDocument('# Flow\n', 'flow.md', SEMANTIC_MODEL)).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Flow documents must contain exactly one fenced ```yaml``` block.',
    },
  ]);

  expect(
    validateFlowDocument(
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

it('reports invalid YAML and invalid top-level flow shapes', () => {
  expect(
    validateFlowDocument(
      ['```yaml', 'jobs: [', '```', ''].join('\n'),
      'flow.md',
      SEMANTIC_MODEL,
    )[0].message,
  ).toContain('Invalid YAML flow definition:');

  expect(
    validateFlowDocument(
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
    validateFlowDocument(
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

it('skips semantic checks when no semantic model is provided', () => {
  expect(
    validateFlowDocument(
      ['```yaml', 'jobs:', '  build: {}', '```', ''].join('\n'),
      'flow.md',
      null,
    ),
  ).toEqual([]);
});

it('validates semantic references across nested flow nodes', () => {
  expect(
    validateFlowDocument(
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

it('accepts job-level worktree policy and rejects invalid worktree shapes', () => {
  expect(
    validateFlowDocument(
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
    validateFlowDocument(
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

it('rejects step-level worktree overrides', () => {
  expect(
    validateFlowDocument(
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

it('rejects select queries over reserved runtime classes and validates explicit transition states', () => {
  expect(
    validateFlowDocument(
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

it('validates executable query binding syntax in select, await, and if nodes', () => {
  expect(
    validateFlowDocument(
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

it('validates job-level needs references', () => {
  expect(
    validateFlowDocument(
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

it('validates malformed needs arrays and earlier-job ordering', () => {
  expect(validateFlow(createEarlierNeedsFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected flow.jobs.review.needs[0] to reference an earlier declared job.',
    },
  ]);

  expect(validateFlow(createNonArrayNeedsFlow())).toEqual([
    {
      file_path: 'flow.md',
      message: 'Expected flow.jobs.review.needs to be an array of job names.',
    },
  ]);
});

it('validates additional worktree policy failures', () => {
  expect(validateFlow(createNonObjectWorktreeFlow())).toEqual([
    {
      file_path: 'flow.md',
      message: 'Expected flow.jobs.build.worktree to be an object.',
    },
  ]);

  expect(validateFlow(createUnsupportedWorktreeModeFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected flow.jobs.build.worktree.mode to be "ephemeral" or "named".',
    },
  ]);

  expect(validateFlow(createEphemeralSlotFlow())).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Did not expect flow.jobs.build.worktree.slot when mode is "ephemeral".',
    },
  ]);
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
