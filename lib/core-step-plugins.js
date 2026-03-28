/** @import * as zod from 'zod'; */
/** @import { PluginDefinition } from './plugin-contract.js' */
import core_approval_plugin from './core-plugins/approval.js';
import core_flow_dispatch_plugin from './core-plugins/flow-dispatch.js';
import core_git_status_plugin from './core-plugins/git-status.js';
import core_run_codex_plugin from './core-plugins/run-codex.js';
import core_run_plugin from './core-plugins/run.js';

export { readCoreStepPlugin };

/**
 * @param {string} uses_value
 * @returns {PluginDefinition<any, Record<string, zod.ZodType>, zod.ZodType | undefined> | null}
 */
function readCoreStepPlugin(uses_value) {
  switch (uses_value) {
    case 'core/approval':
      return core_approval_plugin;
    case 'core/flow-dispatch':
      return core_flow_dispatch_plugin;
    case 'core/git-status':
      return core_git_status_plugin;
    case 'core/run':
      return core_run_plugin;
    case 'core/run-codex':
      return core_run_codex_plugin;
    default:
      return null;
  }
}
