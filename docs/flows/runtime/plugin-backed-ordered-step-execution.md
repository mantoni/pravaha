---
Kind: flow
Id: plugin-backed-ordered-step-execution
Status: active
---

# Plugin-Backed Ordered Step Execution

This root flow captures the slice where selected-task jobs still run as one
ordinary ordered step list inside the assigned worktree while `uses` may load
checked-in local plugins or installed npm plugins directly from the declared
flow policy.

```yaml
kind: flow
id: plugin-backed-ordered-step-execution
status: active
scope: contract

jobs:
  implement_ready_tasks:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: core/lease-task
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
