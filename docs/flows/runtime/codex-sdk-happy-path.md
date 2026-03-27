---
Kind: flow
Id: codex-sdk-happy-path
Status: active
---

# Codex SDK Happy Path

This root flow captures the intended single-task vertical slice for the first
SDK-backed runtime contract. The hard-coded entrypoint may further narrow this
to the first semantic `ready` task until the full query surface lands. The
current executable entrypoint is `pravaha run-happy-path`. The engine acquires
the task lease and prepares the worktree before these declared steps run, while
project-specific setup remains an ordinary declared step.

```yaml
kind: flow
id: codex-sdk-happy-path
status: active
scope: contract

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  run_first_ready_task:
    worktree:
      mode: ephemeral
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
