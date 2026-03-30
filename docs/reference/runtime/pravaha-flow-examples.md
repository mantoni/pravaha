---
Kind: reference
Id: pravaha-flow-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Examples

This document captures illustrative JavaScript flow module examples for the
checked-in runtime surface.

## Example Repo Config

```json
{
  "workspaces": {
    "app": {
      "mode": "pooled",
      "paths": [".pravaha/worktrees/abbott", ".pravaha/worktrees/castello"],
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    },
    "validation": {
      "mode": "ephemeral",
      "base_path": ".pravaha/worktrees/validation",
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    }
  },
  "plugins": {
    "dir": "plugins"
  },
  "flows": {
    "default_matches": ["docs/flows/runtime/*.js"]
  }
}
```

## Implement Then Review

```js
import { approve, defineFlow, runCodex } from 'pravaha';

export default defineFlow({
  on: {
    patram:
      '$class == task and tracked_in == contract:task-reviewed-then-merge and status == ready',
  },

  workspace: {
    id: 'app',
  },

  async main(ctx) {
    await runCodex(ctx, {
      prompt: `Implement the task in ${ctx.task.path}.`,
      reasoning: 'medium',
    });
    await approve(ctx, {
      title: `Review ${ctx.task.path}`,
      message: 'Approve or request another revision.',
      data: {
        revision_prompt: `Address the latest review feedback for ${ctx.task.path}.`,
      },
    });
  },

  async onApprove(ctx, data) {
    await runCodex(ctx, {
      prompt: data.revision_prompt,
      reasoning: 'medium',
    });
  },
});
```

## Implement Then Handoff

```js
import { defineFlow, run, runCodex, worktreeHandoff } from 'pravaha';

export default defineFlow({
  on: {
    patram:
      '$class == task and tracked_in == contract:integration-handoff and status == ready',
  },

  workspace: {
    id: 'app',
  },

  async main(ctx) {
    await runCodex(ctx, {
      prompt: `Implement the task in ${ctx.task.path}.`,
      reasoning: 'medium',
    });
    await run(ctx, {
      capture: ['stdout', 'stderr'],
      command: 'npm test',
    });
    await worktreeHandoff(ctx, {
      branch: `review/ready/${ctx.task.id.replaceAll(':', '-')}`,
    });
  },
});
```

## Land A Reviewed Branch

```js
import { defineFlow, run } from 'pravaha';

export default defineFlow({
  on: {
    patram:
      '$class == task and tracked_in == contract:reviewed-branch-landed and status == ready',
  },

  workspace: {
    id: 'app',
  },

  async main(ctx) {
    await run(ctx, {
      command: `git merge --no-ff --message "Merge reviewed work for ${ctx.task.path}" review/ready/${ctx.task.id.replaceAll(':', '-')}`,
    });
  },
});
```

## Publish Worktree Output

```js
import { defineFlow, worktreeHandoff } from 'pravaha';

export default defineFlow({
  on: {
    patram:
      '$class == task and tracked_in == contract:publish-worktree-output and status == ready',
  },

  workspace: {
    id: 'app',
  },

  async main(ctx) {
    await worktreeHandoff(ctx, {
      branch: `review/ready/${ctx.task.id.replaceAll(':', '-')}`,
    });
  },
});
```

## Flow Shape Summary

```json
{
  "top_level_keys": ["on", "workspace", "main", "onApprove", "onError"],
  "runtime_bindings": [
    "document",
    "task",
    "ctx.state",
    "ctx.run_id",
    "ctx.worktree_path"
  ],
  "built_ins": [
    "run(ctx, with)",
    "runCodex(ctx, with)",
    "approve(ctx, with)",
    "worktreeHandoff(ctx, with)"
  ],
  "invariants": [
    "One checked-in flow module defines the trigger, workspace, and handlers for a contract.",
    "Durable state survives replay only after await ctx.setState(...).",
    "Named re-entry handlers receive wait payload data from the stored run snapshot."
  ]
}
```
