---
Kind: flow
Id: job-level-worktree-policy
Status: active
---

# Job-Level Worktree Policy

This root flow captures the migrated slice where checked-in flows express
disposable and reusable pooled worktrees through one flow-level workspace
contract rather than through job-local policy.

```yaml
kind: flow
id: job-level-worktree-policy
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: pooled
    ref: main

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
    next:
      - if: ${{ result.outcome == "success" }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
