---
Kind: flow
Id: runtime-node-lifecycle
Status: active
---

# Runtime Node Lifecycle

This root flow captures the slice where reserved runtime nodes keep a stable
view of the current run and its retained terminal snapshot while the checked-in
flow surface advances through explicit job nodes.

```yaml
kind: flow
id: runtime-node-lifecycle
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
        goto: inspect_workspace
      - goto: failed

  inspect_workspace:
    uses: core/git-status
    next:
      - if: ${{ result.dirty == true }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
