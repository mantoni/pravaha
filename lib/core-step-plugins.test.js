import { expect, it } from 'vitest';

import { readCoreStepPlugin } from './core-step-plugins.js';

it('returns the supported built-in step plugins', () => {
  expect(readCoreStepPlugin('core/approval')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/run-codex')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/flow-dispatch')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/git-status')).toMatchObject({
    emits: {},
  });
  expect(readCoreStepPlugin('core/run')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/missing')).toBeNull();
});
