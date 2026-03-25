---
Kind: flow
Id: strict-runtime-resume
Status: proposed
---

# Strict Runtime Resume

This root flow captures the strict runtime persistence and manual resume slice.
It stays within the current validated flow surface while the runtime learns to
block new reconcile work whenever unresolved local state exists.

```yaml
kind: flow
id: strict-runtime-resume
status: proposed
scope: contract

jobs:
  reconcile_or_resume_first_ready_task:
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
