---
Kind: flow
Id: runtime-node-lifecycle
Status: proposed
---

# Runtime Node Lifecycle

This root flow captures the next slice where the runtime-node lifecycle becomes
explicit enough for flows to query the current run predictably through the mixed
graph: active runtime signals stay visible for the whole unresolved run, while
only the minimal terminal snapshot remains after completion.

```yaml
kind: flow
id: runtime-node-lifecycle
status: proposed
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
