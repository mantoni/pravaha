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
