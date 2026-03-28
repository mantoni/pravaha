import { expect, it } from 'vitest';

import { parseFlowDefinition } from './load-flow-definition.js';

it('parses a native yaml flow definition', () => {
  expect(
    parseFlowDefinition(
      [
        'jobs:',
        '  demo:',
        '    uses: core/run',
        '    next: done',
        '  done:',
        '    end: success',
        '',
      ].join('\n'),
      'flow.yaml',
    ),
  ).toEqual({
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
  });
});

it('rejects empty and multi-document yaml sources', () => {
  expect(parseFlowDefinition('', 'flow.yaml')).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow documents must contain exactly one YAML document.',
      },
    ],
    flow_definition: null,
  });

  expect(
    parseFlowDefinition(
      ['jobs: {}', '---', 'jobs: {}', ''].join('\n'),
      'flow.yaml',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow documents must contain exactly one YAML document.',
      },
    ],
    flow_definition: null,
  });
});

it('rejects invalid yaml and invalid top-level flow shapes', () => {
  expect(parseFlowDefinition(['jobs: [', ''].join('\n'), 'flow.yaml')).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
    ],
    flow_definition: null,
  });

  expect(parseFlowDefinition(['- task', ''].join('\n'), 'flow.yaml')).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow YAML must evaluate to an object.',
      },
    ],
    flow_definition: null,
  });

  expect(
    parseFlowDefinition(['kind: flow', ''].join('\n'), 'flow.yaml'),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: 'Flow YAML must define a top-level "jobs" mapping.',
      },
    ],
    flow_definition: null,
  });
});

it('accepts CRLF yaml sources', () => {
  expect(
    parseFlowDefinition(
      ['jobs:', '  demo: null', ''].join('\r\n'),
      'flow.yaml',
    ),
  ).toEqual({
    diagnostics: [],
    flow_definition: {
      jobs: {
        demo: null,
      },
    },
  });
});

it('preserves multiple yaml parser diagnostics', () => {
  expect(
    parseFlowDefinition(
      [
        'jobs:',
        '  demo:',
        '    next:',
        '      - goto: [',
        '      - goto: [',
        '',
      ].join('\n'),
      'flow.yaml',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.yaml',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
      {
        file_path: 'flow.yaml',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
    ],
    flow_definition: null,
  });
});
