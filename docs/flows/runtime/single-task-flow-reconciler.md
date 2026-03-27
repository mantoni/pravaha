---
Kind: flow
Id: single-task-flow-reconciler
Status: active
---

# Single-Task Flow Reconciler

This root flow captures the first interpreted reconciler slice. It stays inside
the currently validated flow surface while the reconciler reads the checked-in
contract flow through `pravaha reconcile`. The reconciler acquires the task
lease and worktree assignment before the declared step list begins.

```yaml
kind: flow
id: single-task-flow-reconciler
status: active
scope: contract

jobs:
  reconcile_first_ready_task:
    select:
      role: task
    worktree:
      mode: ephemeral
    steps:
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
