---
Kind: flow
Id: mixed-graph-flow-surface
Status: proposed
---

# Mixed-Graph Flow Surface

This root flow captures the next slice where the checked-in flow language will
drive durable selection, runtime-aware conditions, and explicit mutation targets
through the mixed graph. Until that widened surface lands, this flow stays
inside the currently validated subset.

```yaml
kind: flow
id: mixed-graph-flow-surface
status: proposed
scope: contract

jobs:
  implement_ready_tasks:
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
