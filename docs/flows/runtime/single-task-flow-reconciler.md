---
Kind: flow
Id: single-task-flow-reconciler
Status: proposed
---

# Single-Task Flow Reconciler

This root flow captures the first interpreted reconciler slice. It stays inside
the currently validated flow surface while the reconciler learns to read the
checked-in contract flow instead of following a bespoke happy-path selection.

```yaml
kind: flow
id: single-task-flow-reconciler
status: proposed
scope: contract

jobs:
  reconcile_first_ready_task:
    select:
      role: task
    steps:
      - uses: core/lease-task
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
