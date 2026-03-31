/** @import * as zod from 'zod'; */
/** @import { PluginDefinition } from './plugin-contract.js' */
import { approve } from './core/approval.js';
import { flowDispatch } from './core/flow-dispatch.js';
import { gitMerge } from './core/git-merge.js';
import { gitRebase } from './core/git-rebase.js';
import { gitStatus } from './core/git-status.js';
import { gitSquash } from './core/git-squash.js';
import { queueHandoff } from './core/queue-handoff.js';
import { run } from './core/run.js';
import { runCodex } from './core/run-codex.js';
import { worktreeHandoff } from './core/worktree-handoff.js';
import { worktreeMerge } from './core/worktree-merge.js';
import { worktreeRebase } from './core/worktree-rebase.js';
import { worktreeSquash } from './core/worktree-squash.js';

export { readCoreStepPlugin };

/** @type {Record<string, PluginDefinition<any, zod.ZodType | undefined>>} */
const CORE_STEP_PLUGIN_MAP = {
  'core/approval': approve,
  'core/flow-dispatch': flowDispatch,
  'core/git-merge': gitMerge,
  'core/git-rebase': gitRebase,
  'core/git-status': gitStatus,
  'core/git-squash': gitSquash,
  'core/queue-handoff': queueHandoff,
  'core/run': run,
  'core/run-codex': runCodex,
  'core/worktree-handoff': worktreeHandoff,
  'core/worktree-merge': worktreeMerge,
  'core/worktree-rebase': worktreeRebase,
  'core/worktree-squash': worktreeSquash,
};

/**
 * @param {string} uses_value
 * @returns {PluginDefinition<any, zod.ZodType | undefined> | null}
 */
function readCoreStepPlugin(uses_value) {
  return CORE_STEP_PLUGIN_MAP[uses_value] ?? null;
}
