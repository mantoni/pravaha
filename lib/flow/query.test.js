import { expect, it } from 'vitest';

import {
  compileFlowQuery,
  createQueryBindings,
  normalizeFlowQuery,
  validateExecutableQueryText,
  validateSelectQueryText,
} from './query.js';

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
  expect(createQueryBindings({})).toBeUndefined();
});

it('rejects reserved runtime classes in select queries', () => {
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

it('requires one durable semantic role in select queries', () => {
  expect(
    validateSelectQueryText(
      '$class in [task, contract]',
      'flow.md',
      'flow.jobs.run.select',
      new Set(['task', 'contract']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Select queries must constrain $class to exactly one durable semantic role. in flow.jobs.run.select.',
    },
  ]);
  expect(
    validateSelectQueryText(
      'status == ready',
      'flow.md',
      'flow.jobs.run.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Select queries must constrain $class to exactly one durable semantic role. in flow.jobs.run.select.',
    },
  ]);
});

it('rejects unknown semantic roles in select queries', () => {
  expect(
    validateSelectQueryText(
      '$class == worker',
      'flow.md',
      'flow.jobs.run.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unknown semantic role "worker" in select query. in flow.jobs.run.select.',
    },
  ]);
});

it('validates executable query bindings while preserving literal task values', () => {
  expect(
    validateExecutableQueryText(
      '$class == $signal and subject == task and tracked_in == @document',
      'flow.md',
      'flow.jobs.run.next[0].if',
    ),
  ).toEqual([]);
  expect(
    validateExecutableQueryText(
      '$class == $signal and tracked_in == @Task',
      'flow.md',
      'flow.jobs.run.next[0].if',
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unsupported query binding "@Task". at flow.jobs.run.next[0].if.',
    },
  ]);
});

it('validates top-level none executable queries by validating the inner query', () => {
  expect(
    validateExecutableQueryText(
      'none($class == task and tracked_in == @document)',
      'flow.md',
      'flow.jobs.review.if',
    ),
  ).toEqual([]);
});

it('filters non-string bindings and surfaces additional query diagnostics', () => {
  expect(
    createQueryBindings({
      document: /** @type {never} */ (7),
    }),
  ).toBeUndefined();
  expect(
    validateExecutableQueryText(
      '$class == $signal and tracked_in == @missing',
      'flow.md',
      'flow.jobs.review.if',
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Missing query binding "missing". at flow.jobs.review.if.',
    },
  ]);
  expect(
    validateSelectQueryText(
      '$class == worker',
      'flow.md',
      'flow.jobs.review.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unknown semantic role "worker" in select query. in flow.jobs.review.select.',
    },
  ]);
});

it('accepts list-based select role queries and surfaces parser diagnostics', () => {
  expect(
    validateSelectQueryText(
      '$class in [task, task]',
      'flow.md',
      'flow.jobs.review.select',
      new Set(['task']),
    ),
  ).toEqual([]);
  expect(
    validateExecutableQueryText(
      '$class == $signal and (',
      'flow.md',
      'flow.jobs.review.if',
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: expect.stringContaining('at flow.jobs.review.if.'),
    },
  ]);
});

it('surfaces select-query parser failures before semantic-role resolution', () => {
  expect(
    validateSelectQueryText(
      '$class == task and (',
      'flow.md',
      'flow.jobs.review.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: expect.stringContaining('at flow.jobs.review.select.'),
    },
  ]);
});

it('recursively validates nested none queries and rejects unsupported executable bindings', () => {
  expect(
    validateExecutableQueryText(
      'none(none($class == task and tracked_in == @document))',
      'flow.md',
      'flow.jobs.review.if',
    ),
  ).toEqual([]);
  expect(
    validateExecutableQueryText(
      '$class == $signal and tracked_in == @document and assigned_to == @worker',
      'flow.md',
      'flow.jobs.review.if',
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Missing query binding "worker". at flow.jobs.review.if.',
    },
  ]);
});
