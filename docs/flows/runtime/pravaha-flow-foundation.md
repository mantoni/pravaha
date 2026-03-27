---
Kind: flow
Id: pravaha-flow-foundation
Status: active
---

# Pravaha Flow Foundation

This root flow anchors the first validated checked-in state-machine flow shape.

```yaml
kind: flow
id: pravaha-flow-foundation
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
  bootstrap:
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
    next: done

  done:
    end: success
```
