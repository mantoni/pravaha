/** @import * as zod from 'zod'; */
/** @import { PluginDefinition } from './plugin-contract.js' */
import core_approval_plugin from './core/approval.js';
import core_flow_dispatch_plugin from './core/flow-dispatch.js';
import core_git_merge_plugin from './core/git-merge.js';
import core_git_rebase_plugin from './core/git-rebase.js';
import core_git_status_plugin from './core/git-status.js';
import core_git_squash_plugin from './core/git-squash.js';
import core_queue_handoff_plugin from './core/queue-handoff.js';
import core_run_codex_plugin from './core/run-codex.js';
import core_run_plugin from './core/run.js';
import core_worktree_handoff_plugin from './core/worktree-handoff.js';
import core_worktree_merge_plugin from './core/worktree-merge.js';
import core_worktree_rebase_plugin from './core/worktree-rebase.js';
import core_worktree_squash_plugin from './core/worktree-squash.js';

export { readCoreStepPlugin };

/** @type {Record<string, PluginDefinition<any, zod.ZodType | undefined>>} */
const CORE_STEP_PLUGIN_MAP = {
  'core/approval': core_approval_plugin,
  'core/flow-dispatch': core_flow_dispatch_plugin,
  'core/git-merge': core_git_merge_plugin,
  'core/git-rebase': core_git_rebase_plugin,
  'core/git-status': core_git_status_plugin,
  'core/git-squash': core_git_squash_plugin,
  'core/queue-handoff': core_queue_handoff_plugin,
  'core/run': core_run_plugin,
  'core/run-codex': core_run_codex_plugin,
  'core/worktree-handoff': core_worktree_handoff_plugin,
  'core/worktree-merge': core_worktree_merge_plugin,
  'core/worktree-rebase': core_worktree_rebase_plugin,
  'core/worktree-squash': core_worktree_squash_plugin,
};

/**
 * @param {string} uses_value
 * @returns {PluginDefinition<any, zod.ZodType | undefined> | null}
 */
function readCoreStepPlugin(uses_value) {
  return CORE_STEP_PLUGIN_MAP[uses_value] ?? null;
}
