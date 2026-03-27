---
Kind: flow
Id: plugin-backed-ordered-step-execution
Status: active
---

# Plugin-Backed Ordered Step Execution

This root flow captures the slice where task-triggered jobs still run as one
ordinary ordered step list inside the assigned worktree while `uses` may load
checked-in local plugins or installed npm plugins directly from the declared
flow policy. The task lease and initial worktree assignment remain engine-owned
runtime behavior rather than user-authored plugin steps.

```yaml
kind: flow
id: plugin-backed-ordered-step-execution
status: active
scope: contract

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement_ready_tasks:
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: local/prepare-worktree
        with:
          command: npm test
      - uses: core/codex-sdk
      - await: worker_completed
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == success
        transition:
          target: task
          status: review
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == failure
        transition:
          target: task
          status: blocked
```
