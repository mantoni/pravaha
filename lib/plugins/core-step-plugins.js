/** @import * as zod from 'zod'; */
/** @import { PluginDefinition } from './plugin-contract.js' */
import core_approval_plugin from './core/approval.js';
import core_flow_dispatch_plugin from './core/flow-dispatch.js';
import core_git_merge_plugin from './core/git-merge.js';
import core_git_rebase_plugin from './core/git-rebase.js';
import core_git_status_plugin from './core/git-status.js';
import core_git_squash_plugin from './core/git-squash.js';
import core_run_codex_plugin from './core/run-codex.js';
import core_run_plugin from './core/run.js';

export { readCoreStepPlugin };

/**
 * @param {string} uses_value
 * @returns {PluginDefinition<any, zod.ZodType | undefined> | null}
 */
function readCoreStepPlugin(uses_value) {
  switch (uses_value) {
    case 'core/approval':
      return core_approval_plugin;
    case 'core/flow-dispatch':
      return core_flow_dispatch_plugin;
    case 'core/git-merge':
      return core_git_merge_plugin;
    case 'core/git-rebase':
      return core_git_rebase_plugin;
    case 'core/git-status':
      return core_git_status_plugin;
    case 'core/git-squash':
      return core_git_squash_plugin;
    case 'core/run':
      return core_run_plugin;
    case 'core/run-codex':
      return core_run_codex_plugin;
    default:
      return null;
  }
}
