/** @import * as $k$$k$$l$flow$l$flow$j$contract$k$js from '../flow/flow-contract.js'; */
import { expect, it, vi } from 'vitest';

import { attachFlowRuntime } from '../flow/runtime.js';
import { definePlugin } from './plugin-contract.js';

it('defines branded frozen plugins', () => {
  const pluginDefinition = definePlugin({
    run(context) {
      void context;
      return Promise.resolve();
    },
  });

  expect(Object.isFrozen(pluginDefinition)).toBe(true);
  expect(pluginDefinition.run).toBeTypeOf('function');
});

it('returns callable plugins for direct flow invocation', async () => {
  const pluginDefinition = definePlugin({
    run(context) {
      return Promise.resolve({
        with: readContextWith(context),
      });
    },
  });
  const invokePlugin = vi.fn(
    /**
     * @param {unknown} _plugin_definition
     * @param {unknown} with_value
     * @returns {Promise<{ with: unknown }>}
     */
    (_plugin_definition, with_value) =>
      Promise.resolve({
        with: with_value,
      }),
  );
  const ctx =
    /** @type {$k$$k$$l$flow$l$flow$j$contract$k$js.TaskFlowContext} */ (
      attachFlowRuntime({}, { invoke_plugin: invokePlugin })
    );

  await expect(pluginDefinition(ctx, { command: 'true' })).resolves.toEqual({
    with: {
      command: 'true',
    },
  });
  expect(invokePlugin).toHaveBeenCalledWith(pluginDefinition, {
    command: 'true',
  });
});

/**
 * @param {unknown} context
 * @returns {unknown}
 */
function readContextWith(context) {
  return /** @type {{ with: unknown }} */ (context).with;
}

it('rejects invalid plugin definitions', () => {
  expect(() => definePlugin(/** @type {never} */ (null))).toThrow(
    'Plugin definition must be an object.',
  );
});
