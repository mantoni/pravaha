import { expect, it } from 'vitest';

import {
  renderStateMachineValue,
  selectStateMachineNextTarget,
} from './state-machine-runtime.js';

it('renders nested template values against task and prior job outputs', () => {
  expect(
    renderStateMachineValue(
      {
        prompt: 'Fix ${{ task.path }} after ${{ jobs.test.outputs.stdout }}.',
      },
      {
        jobs: {
          test: {
            outputs: {
              stdout: 'lint failed',
            },
          },
        },
        result: {},
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
    ),
  ).toEqual({
    prompt:
      'Fix docs/tasks/runtime/implement-runtime-slice.md after lint failed.',
  });
});

it('formats undefined and structured values when interpolating inside strings', () => {
  expect(
    renderStateMachineValue(
      'stdout=${{ result.stdout }}; stderr=${{ result.stderr }}; meta=${{ ({ ok: true }) }}',
      {
        jobs: {},
        result: {
          stdout: 'passed',
        },
      },
    ),
  ).toBe('stdout=passed; stderr=; meta={"ok":true}');
});

it('selects the first matching next branch and returns null when none match', () => {
  expect(
    selectStateMachineNextTarget(
      [
        {
          condition_text: '${{ result.exit_code == 0 }}',
          target_job_name: 'done',
        },
        {
          condition_text: null,
          target_job_name: 'retry',
        },
      ],
      {
        jobs: {},
        result: {
          exit_code: 1,
        },
      },
    ),
  ).toBe('retry');
  expect(
    selectStateMachineNextTarget(
      [
        {
          condition_text: '${{ result.exit_code == 0 }}',
          target_job_name: 'done',
        },
      ],
      {
        jobs: {},
        result: {
          exit_code: 1,
        },
      },
    ),
  ).toBeNull();
});

it('rejects next conditions that do not evaluate to booleans', () => {
  expect(() =>
    selectStateMachineNextTarget(
      [
        {
          condition_text: '${{ result.exit_code }}',
          target_job_name: 'done',
        },
      ],
      {
        jobs: {},
        result: {
          exit_code: 1,
        },
      },
    ),
  ).toThrow('Expected state-machine next condition to evaluate to a boolean');
});
