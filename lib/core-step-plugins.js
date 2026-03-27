import { z } from 'zod';

import { definePlugin } from './plugin-contract.js';

/**
 * @typedef {import('zod').ZodType} ZodType
 */

/**
 * @typedef {{
 *   emits: Record<string, ZodType>,
 *   run: (context: Record<string, unknown>) => Promise<unknown> | unknown,
 *   with?: ZodType,
 * }} PluginDefinition
 */

export { readCoreStepPlugin };

/** @type {PluginDefinition} */
const CORE_CODEX_SDK_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {
      worker_completed: z.object({
        outcome: z.enum(['failure', 'success']),
        subject: z.enum(['document', 'task']),
      }),
    },
    async run(context) {
      void context;
    },
  })
);

/** @type {PluginDefinition} */
const CORE_REQUEST_REVIEW_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    async run(context) {
      void context;
    },
  })
);

/** @type {PluginDefinition} */
const CORE_AGENT_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    run: CORE_CODEX_SDK_PLUGIN.run,
    with: z.object({
      prompt: z.string(),
      provider: z.string(),
    }),
  })
);

/** @type {PluginDefinition} */
const CORE_RUN_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    async run(context) {
      void context;
    },
    with: z.object({
      capture: z.array(z.enum(['stderr', 'stdout'])).optional(),
      command: z.string(),
    }),
  })
);

/** @type {PluginDefinition} */
const CORE_APPROVAL_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    async run(context) {
      void context;
    },
    with: z.object({
      message: z.string(),
      options: z.array(z.string()),
      title: z.string(),
    }),
  })
);

/** @type {PluginDefinition} */
const CORE_GIT_STATUS_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    async run(context) {
      void context;
    },
  })
);

/** @type {PluginDefinition} */
const CORE_FLOW_DISPATCH_PLUGIN = /** @type {PluginDefinition} */ (
  definePlugin({
    emits: {},
    async run(context) {
      void context;
    },
    with: z.object({
      flow: z.string(),
      inputs: z.record(z.string(), z.unknown()).optional(),
      wait: z.boolean().optional(),
    }),
  })
);

/**
 * @param {string} uses_value
 * @returns {PluginDefinition | null}
 */
function readCoreStepPlugin(uses_value) {
  switch (uses_value) {
    case 'core/agent':
      return CORE_AGENT_PLUGIN;
    case 'core/approval':
      return CORE_APPROVAL_PLUGIN;
    case 'core/codex-sdk':
      return CORE_CODEX_SDK_PLUGIN;
    case 'core/flow-dispatch':
      return CORE_FLOW_DISPATCH_PLUGIN;
    case 'core/git-status':
      return CORE_GIT_STATUS_PLUGIN;
    case 'core/request-review':
      return CORE_REQUEST_REVIEW_PLUGIN;
    case 'core/run':
      return CORE_RUN_PLUGIN;
    default:
      return null;
  }
}
