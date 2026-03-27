---
Kind: flow
Id: strict-runtime-resume
Status: active
---

# Strict Runtime Resume

This root flow captures the strict runtime persistence and manual resume slice.
It stays within the current validated flow surface while the runtime blocks new
reconcile work whenever unresolved local state exists and resumes through
`pravaha resume`. Lease acquisition still happens before declared steps and is
reused from the persisted runtime record on resume.

```yaml
kind: flow
id: strict-runtime-resume
status: active
scope: contract

jobs:
  reconcile_or_resume_first_ready_task:
    select:
      role: task
    worktree:
      mode: ephemeral
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
