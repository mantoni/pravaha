import { expect, it } from 'vitest';

import { readCoreStepPlugin } from './core-step-plugins.js';

it('returns the supported built-in step plugins', () => {
  expect(readCoreStepPlugin('core/agent')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/approval')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/codex-sdk')).toMatchObject({
    emits: {
      worker_completed: expect.anything(),
    },
  });
  expect(readCoreStepPlugin('core/flow-dispatch')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/git-status')).toMatchObject({
    emits: {},
  });
  expect(readCoreStepPlugin('core/request-review')).toMatchObject({
    emits: {},
  });
  expect(readCoreStepPlugin('core/run')).toMatchObject({
    with: expect.anything(),
  });
  expect(readCoreStepPlugin('core/missing')).toBeNull();
});

it('runs every distinct built-in plugin handler', async () => {
  for (const uses_value of [
    'core/agent',
    'core/approval',
    'core/codex-sdk',
    'core/flow-dispatch',
    'core/git-status',
    'core/request-review',
    'core/run',
  ]) {
    const plugin_definition = readCoreStepPlugin(uses_value);

    expect(plugin_definition).not.toBeNull();
    await plugin_definition?.run({});
  }
});
