/** @import { CorePluginContext, FlowDispatchWith } from './types.ts' */
import { z } from 'zod';

import { definePlugin } from '../plugin-contract.js';

export default definePlugin({
  with: z.object({
    flow: z.string(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    wait: z.boolean().optional(),
  }),
  /**
   * @param {CorePluginContext<FlowDispatchWith>} context
   * @returns {Promise<Record<string, unknown>>}
   */
  run(context) {
    return context.dispatchFlow({
      flow: context.with.flow,
      inputs: context.with.inputs,
      wait: context.with.wait,
    });
  },
});
