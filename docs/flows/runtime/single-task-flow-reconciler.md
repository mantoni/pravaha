---
Kind: flow
Id: single-task-flow-reconciler
Status: active
---

# Single-Task Flow Reconciler

This root flow captures the first interpreted reconciler slice. The reconciler
creates one durable flow instance per matched ready task, resolves one
flow-level workspace for that instance, and advances it one job node at a time.

```yaml
kind: flow
id: single-task-flow-reconciler
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: ephemeral
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
