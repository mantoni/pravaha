import { expect, it } from 'vitest';

import {
  compileFlowQuery,
  createQueryBindings,
  normalizeFlowQuery,
  resolveSelectQueryRole,
  validateExecutableQueryText,
  usesQuerySyntax,
  validateSelectQueryText,
} from './flow-query.js';

it('normalizes flow queries and prepares Patram query bindings', () => {
  expect(compileFlowQuery('$class == task and tracked_in == @document')).toBe(
    '$class = task and tracked_in = @document',
  );
  expect(
    createQueryBindings({
      document: 'contract:runtime',
      task: 'task:runtime',
    }),
  ).toEqual({
    bindings: {
      document: 'contract:runtime',
      task: 'task:runtime',
    },
  });
  expect(normalizeFlowQuery(' $class == task  and status == ready ')).toBe(
    '$class = task and status = ready',
  );
});

it('resolves one durable select role and rejects unsupported select queries', () => {
  expect(
    resolveSelectQueryRole(
      '$class == task and status == ready',
      new Set(['task']),
    ),
  ).toBe('task');
  expect(() =>
    resolveSelectQueryRole('$class == $signal', new Set(['task'])),
  ).toThrow('Reserved runtime classes are not allowed in select queries.');
  expect(() =>
    resolveSelectQueryRole(
      '$class in [task, contract]',
      new Set(['task', 'contract']),
    ),
  ).toThrow(
    'Select queries must constrain $class to exactly one durable semantic role.',
  );
  expect(() =>
    resolveSelectQueryRole('$class == worker', new Set(['task'])),
  ).toThrow('Unknown semantic role "worker" in select query.');
  expect(() =>
    resolveSelectQueryRole('status == ready', new Set(['task'])),
  ).toThrow(
    'Select queries must constrain $class to exactly one durable semantic role.',
  );
});

it('detects query syntax and renders validation diagnostics', () => {
  expect(usesQuerySyntax('$class == task')).toBe(true);
  expect(usesQuerySyntax('task')).toBe(false);
  expect(
    validateSelectQueryText(
      '$class == $signal',
      'flow.md',
      'flow.jobs.run.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Reserved runtime classes are not allowed in flow.jobs.run.select.',
    },
  ]);
});

it('validates executable query bindings while preserving literal task values', () => {
  expect(
    validateExecutableQueryText(
      '$class == $signal and subject == task and tracked_in == @document',
      'flow.md',
      'flow.jobs.run.steps[0].await',
    ),
  ).toEqual([]);
  expect(
    validateExecutableQueryText(
      '$class == $signal and tracked_in == @Task',
      'flow.md',
      'flow.jobs.run.steps[0].await',
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unsupported query binding "@Task". at flow.jobs.run.steps[0].await.',
    },
  ]);
});
