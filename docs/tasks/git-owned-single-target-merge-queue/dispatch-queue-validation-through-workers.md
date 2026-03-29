---
Kind: task
Id: dispatch-queue-validation-through-workers
Status: done
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-optional-queue-validation-flow-and-dispatch-coordination.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Dispatch Queue Validation Through Workers

- Replace inline queue validation-flow execution with runtime-native
  dispatch-and-wait behavior that uses the local worker pool.
- Keep `pravaha queue sync` responsible for queue Git operations while worker
  execution owns flow supervision, retries, and terminal validation outcomes.
- Define the coordination contract between queue sync and the worker runtime so
  candidate validation can resume the queue command with one authoritative
  success or failure result.
- Add tests that prove configured queue validation uses the dispatch runtime
  rather than direct inline state-machine execution.
