import { expect, it } from 'vitest';

import { parseFlowDefinition } from './load-flow-definition.js';

it('parses a single yaml block into a flow definition', () => {
  expect(
    parseFlowDefinition(
      [
        '# Demo Flow',
        '',
        '```yaml',
        'jobs:',
        '  demo:',
        '    uses: core/run',
        '    next: done',
        '  done:',
        '    end: success',
        '```',
        '',
      ].join('\n'),
      'flow.md',
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

it('rejects missing and duplicate yaml blocks', () => {
  expect(parseFlowDefinition('# No YAML\n', 'flow.md')).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message:
          'Flow documents must contain exactly one fenced ```yaml``` block.',
      },
    ],
    flow_definition: null,
  });

  expect(
    parseFlowDefinition(
      ['```yaml', 'jobs: {}', '```', '', '```yaml', 'jobs: {}', '```'].join(
        '\n',
      ),
      'flow.md',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message:
          'Flow documents must not contain more than one fenced ```yaml``` block.',
      },
    ],
    flow_definition: null,
  });
});

it('rejects invalid yaml and invalid top-level flow shapes', () => {
  expect(
    parseFlowDefinition(
      ['```yaml', 'jobs: [', '```', ''].join('\n'),
      'flow.md',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
    ],
    flow_definition: null,
  });

  expect(
    parseFlowDefinition(['```yaml', '- task', '```', ''].join('\n'), 'flow.md'),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message: 'Flow YAML must evaluate to an object.',
      },
    ],
    flow_definition: null,
  });

  expect(
    parseFlowDefinition(
      ['```yaml', 'kind: flow', '```', ''].join('\n'),
      'flow.md',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message: 'Flow YAML must define a top-level "jobs" mapping.',
      },
    ],
    flow_definition: null,
  });
});

it('accepts CRLF fenced yaml blocks', () => {
  expect(
    parseFlowDefinition(
      ['# Demo Flow', '', '```yaml', 'jobs:', '  demo: null', '```', ''].join(
        '\r\n',
      ),
      'flow.md',
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

it('ignores non-yaml fences and preserves multiple yaml parser diagnostics', () => {
  expect(
    parseFlowDefinition(
      [
        '# Demo Flow',
        '',
        '```js',
        'const nope = true;',
        '```',
        '',
        '```yaml',
        'jobs:',
        '  demo:',
        '    next:',
        '      - goto: [',
        '      - goto: [',
        '```',
        '',
      ].join('\n'),
      'flow.md',
    ),
  ).toEqual({
    diagnostics: [
      {
        file_path: 'flow.md',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
      {
        file_path: 'flow.md',
        message: expect.stringContaining('Invalid YAML flow definition:'),
      },
    ],
    flow_definition: null,
  });
});
