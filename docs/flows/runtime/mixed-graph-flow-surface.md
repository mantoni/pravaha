---
Kind: flow
Id: mixed-graph-flow-surface
Status: active
---

# Mixed-Graph Flow Surface

This root flow captures the mixed-graph slice where the checked-in flow language
drives durable selection, runtime-aware conditions, and explicit mutation
targets through the mixed graph.

```yaml
kind: flow
id: mixed-graph-flow-surface
status: active
scope: contract

jobs:
  implement_ready_tasks:
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
