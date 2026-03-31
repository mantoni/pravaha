import { expect, it } from 'vitest';

import { readCoreStepPlugin } from './core-step-plugins.js';

it('returns the supported built-in step plugins', () => {
  assertCallablePluginWithSchema('core/approval');
  assertCallablePluginWithSchema('core/git-merge');
  assertCallablePluginWithSchema('core/git-rebase');
  assertCallablePluginWithSchema('core/worktree-handoff');
  assertCallablePluginWithSchema('core/worktree-merge');
  assertCallablePluginWithSchema('core/worktree-rebase');
  assertCallablePluginWithSchema('core/worktree-squash');
  assertCallablePluginWithSchema('core/run-codex');
  assertCallablePluginWithSchema('core/git-squash');
  assertCallablePluginWithSchema('core/flow-dispatch');
  expect(readCoreStepPlugin('core/git-status')).toBeTypeOf('function');
  expect(readCoreStepPlugin('core/git-status')?.with).toBeUndefined();
  assertCallablePluginWithSchema('core/queue-handoff');
  assertCallablePluginWithSchema('core/run');
  expect(readCoreStepPlugin('core/missing')).toBeNull();
});

/**
 * @param {string} plugin_id
 * @returns {void}
 */
function assertCallablePluginWithSchema(plugin_id) {
  const plugin = readCoreStepPlugin(plugin_id);

  expect(plugin).toBeTypeOf('function');
  expect(plugin?.with).toEqual(expect.anything());
}
