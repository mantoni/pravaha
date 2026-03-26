---
Kind: flow
Id: ordered-worktree-step-execution
Status: active
---

# Ordered Worktree Step Execution

This root flow captures the slice where one selected-task job executes one
ordinary ordered step list inside its assigned worktree. Setup and cleanup stay
in the checked-in step list rather than moving into special lifecycle hooks.

```yaml
kind: flow
id: ordered-worktree-step-execution
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
      - run: npm ci
      - uses: core/setup-worktree
      - uses: core/codex-sdk
      - run: npm test
      - await:
          $class == $signal and kind == worker_completed and subject == task
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
