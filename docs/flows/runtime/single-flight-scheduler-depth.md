---
Kind: flow
Id: single-flight-scheduler-depth
Status: active
---

# Single-Flight Scheduler Depth

This root flow captures the narrow scheduler-depth slice. It keeps the runtime
single-flight while allowing one task job to drain before a contract-scoped
review job can run.

```yaml
kind: flow
id: single-flight-scheduler-depth
status: active
scope: contract

on:
  task:
    where: $class == task and tracked_in == @document

jobs:
  implement_ready_tasks:
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
          target: task
          status: review
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == failure
        transition:
          target: task
          status: blocked

  review_feature:
    needs: [implement_ready_tasks]
    if:
      none($class == task and tracked_in == @document and status != done and
      status != dropped)
    steps:
      - uses: core/request-review
        transition:
          target: document
          status: review
```
