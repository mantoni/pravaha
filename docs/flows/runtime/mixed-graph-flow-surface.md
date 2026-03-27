---
Kind: flow
Id: mixed-graph-flow-surface
Status: active
---

# Mixed-Graph Flow Surface

This root flow captures the mixed-graph slice where the checked-in flow language
drives durable selection, runtime-aware branching, and cross-job data access
through the mixed graph.

```yaml
kind: flow
id: mixed-graph-flow-surface
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
