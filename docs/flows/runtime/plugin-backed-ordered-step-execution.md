---
Kind: flow
Id: plugin-backed-ordered-step-execution
Status: active
---

# Plugin-Backed Ordered Step Execution

This root flow captures the slice where task-triggered jobs run as one explicit
state-machine sequence inside the assigned workspace while `uses` may load
built-in core plugins, checked-in local plugins, or installed npm plugins
directly from the declared flow policy.

```yaml
kind: flow
id: plugin-backed-ordered-step-execution
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
  prepare_workspace:
    uses: local/prepare-worktree
    with:
      command: npm test
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: implement
      - goto: failed

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
