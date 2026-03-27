---
Kind: flow
Id: run-scoped-step-progress-and-plugin-signals
Status: active
---

# Run-Scoped Step Progress And Plugin Signals

This root flow captures the slice where all ordered job steps share one
persisted step-progress model. Plugin-backed steps use that same persisted
position model and stay run-scoped when they emit through `context.emit(...)`
instead of through a global signal bus.

```yaml
kind: flow
id: run-scoped-step-progress-and-plugin-signals
status: active
scope: contract

jobs:
  progress_and_emit_within_one_run:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: named
      slot: castello
    steps:
      - run: npm test
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
