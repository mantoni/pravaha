---
Kind: flow
Id: codex-sdk-happy-path
Status: active
---

# Codex SDK Happy Path

This root flow captures the intended single-task vertical slice for the first
SDK-backed runtime contract. The hard-coded entrypoint may further narrow this
to the first semantic `ready` task until the full query surface lands. The
current executable entrypoint is `pravaha run-happy-path`.

```yaml
kind: flow
id: codex-sdk-happy-path
status: active
scope: contract

jobs:
  run_first_ready_task:
    select:
      role: task
    worktree:
      mode: ephemeral
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
