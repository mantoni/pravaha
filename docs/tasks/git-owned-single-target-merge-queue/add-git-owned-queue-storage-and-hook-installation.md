---
Kind: task
Id: add-git-owned-queue-storage-and-hook-installation
Status: done
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-config-and-init-command.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Add Git-Owned Queue Storage And Hook Installation

- Add queue Git helpers for:
  - listing ordered ready refs
  - resolving queue base and candidate refs
  - updating the validated queue tip
  - pruning adopted ready refs
- Add queue ref policy enforcement through Node hook scripts in the bare queue
  repo.
- Reject direct mutation of internal queue refs such as candidate and metadata
  refs.
- Keep the queue explainable with ordinary Git inspection of refs and commits.
