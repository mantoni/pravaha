---
Kind: flow
Id: job-level-worktree-policy
Status: active
---

# Job-Level Worktree Policy

This root flow captures the slice where checked-in flow policy declares the
worktree lifecycle at job scope. It models both disposable and exact-slot named
worktrees while keeping the current step surface intact.

```yaml
kind: flow
id: job-level-worktree-policy
status: active
scope: contract

jobs:
  implement_ready_tasks:
    select:
      role: task
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: core/setup-worktree
      - uses: core/codex-sdk
      - await:
          $class == $signal and kind == worker_completed and subject == task
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == success
        transition:
          to: review
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == failure
        transition:
          to: blocked
```
