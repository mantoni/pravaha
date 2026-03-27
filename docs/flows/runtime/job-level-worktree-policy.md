---
Kind: flow
Id: job-level-worktree-policy
Status: active
---

# Job-Level Worktree Policy

This root flow captures the slice where checked-in flow policy declares the
worktree assignment and reuse policy at job scope. It models both disposable and
exact-slot named worktrees while keeping setup inside the ordinary declared step
list.

```yaml
kind: flow
id: job-level-worktree-policy
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
      - run: npm ci
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
