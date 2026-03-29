---
Kind: task
Id: add-optional-queue-validation-flow-and-dispatch-coordination
Status: ready
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-sync-pull-and-publish-commands.md
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-handoff-plugin-and-run-resume-semantics.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Add Optional Queue Validation Flow And Dispatch Coordination

- Extend queue config with one optional `validation_flow`.
- Let `pravaha queue sync` dispatch or wake the local worker runtime to execute
  the configured validation flow against the current queue candidate.
- Keep publication explicit even when flow validation succeeds.
- Keep Git-only queue behavior available when `validation_flow` is absent.
- Return validation success or failure to the waiting queued run without making
  workers the source of truth for queue order.
