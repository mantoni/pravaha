---
Kind: task
Id: add-queue-handoff-plugin-and-run-resume-semantics
Status: ready
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-git-owned-queue-storage-and-hook-installation.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Add Queue Handoff Plugin And Run Resume Semantics

- Add one bundled `core/queue-handoff` plugin that accepts an explicit branch
  ref and enqueues it under the configured ready-ref prefix.
- Persist enough bookkeeping to correlate the ready ref with the paused run that
  submitted it.
- Keep the submitting run unresolved until the queue item leaves the queue.
- Resume the waiting run with success when `queue pull` or `queue publish`
  prunes the ready ref after proving adoption.
- Resume the waiting run with failure when `queue sync` rejects the queued entry
  or configured validation fails.
- Keep queue-order truth in Git refs rather than expanding runtime state into a
  second queue ledger.
