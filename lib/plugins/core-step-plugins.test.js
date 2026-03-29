import { expect, it } from 'vitest';

import { readCoreStepPlugin } from './core-step-plugins.js';

it('returns the supported built-in step plugins', () => {
  expect(readCoreStepPlugin('core/approval')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/git-merge')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/git-rebase')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/run-codex')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/git-squash')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/flow-dispatch')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/git-status')).toMatchObject({});
  expect(readCoreStepPlugin('core/run')).toMatchObject({
    with: asMatcher(expect.anything()),
  });
  expect(readCoreStepPlugin('core/missing')).toBeNull();
});

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
