---
Kind: task
Id: add-queue-sync-pull-and-publish-commands
Status: ready
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-config-and-init-command.md
  - docs/tasks/git-owned-single-target-merge-queue/add-git-owned-queue-storage-and-hook-installation.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Add Queue Sync Pull And Publish Commands

- Add `pravaha queue sync` to:
  - fetch the upstream target branch into the bare queue repo
  - rebuild the queue candidate from the upstream base plus ordered ready refs
  - advance the validated queue tip on success
  - reject queued entries that no longer merge cleanly
  - avoid implicit upstream publication
- Add `pravaha queue pull` to explicitly integrate the validated queue tip into
  the current branch and prune only adopted ready refs.
- Add `pravaha queue publish` to explicitly publish the validated queue tip to
  the configured upstream target branch and prune only adopted ready refs.
- Add tests for reachability-based prune behavior and explicit-only adoption.
