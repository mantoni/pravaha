import { expect, it } from 'vitest';

import {
  validateRelateReference,
  validateSemanticRoleReference,
  validateSemanticStateReference,
} from './validate-semantic-reference.js';

it('accepts valid semantic role and state references', () => {
  expect(
    validateSemanticRoleReference(
      {
        roles: ['task', 'contract'],
      },
      'flow.md',
      'flow.jobs.demo.select',
      new Set(['task', 'contract']),
    ),
  ).toEqual([]);

  expect(
    validateSemanticStateReference(
      {
        states: ['ready', 'review'],
      },
      'flow.md',
      'flow.jobs.demo.transition',
      new Set(['ready', 'review']),
    ),
  ).toEqual([]);
});

it('reports unsupported reference shapes', () => {
  expect(
    validateSemanticRoleReference(
      7,
      'flow.md',
      'flow.jobs.demo.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Unsupported role reference shape at flow.jobs.demo.select.',
    },
  ]);

  expect(
    validateSemanticStateReference(
      {
        nope: 'ready',
      },
      'flow.md',
      'flow.jobs.demo.transition',
      new Set(['ready']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Unsupported state reference shape at flow.jobs.demo.transition.',
    },
  ]);
});

it('reports invalid scalar values in semantic references', () => {
  expect(
    validateSemanticRoleReference(
      {
        role: {
          nope: true,
        },
      },
      'flow.md',
      'flow.jobs.demo.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected role reference at flow.jobs.demo.select.role to be a string or string array.',
    },
  ]);

  expect(
    validateSemanticStateReference(
      ['ready', 1],
      'flow.md',
      'flow.jobs.demo.transition',
      new Set(['ready']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected state reference at flow.jobs.demo.transition[1] to be a non-empty string.',
    },
  ]);
});

it('validates relate role references and ignores non-object relate values', () => {
  expect(
    validateRelateReference(
      {
        from_role: 'task',
        to_role: ['contract', ''],
      },
      'flow.md',
      'flow.jobs.demo.steps[0].relate',
      new Set(['task', 'contract']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message:
        'Expected role reference at flow.jobs.demo.steps[0].relate.to_role[1] to be a non-empty string.',
    },
  ]);

  expect(
    validateRelateReference(
      'tracked_in',
      'flow.md',
      'flow.jobs.demo.steps[0].relate',
      new Set(['task']),
    ),
  ).toEqual([]);
});

it('rejects null object-like semantic references', () => {
  expect(
    validateSemanticRoleReference(
      null,
      'flow.md',
      'flow.jobs.demo.select',
      new Set(['task']),
    ),
  ).toEqual([
    {
      file_path: 'flow.md',
      message: 'Unsupported role reference shape at flow.jobs.demo.select.',
    },
  ]);
});
