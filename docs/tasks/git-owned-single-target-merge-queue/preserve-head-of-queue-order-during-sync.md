---
Kind: task
Id: preserve-head-of-queue-order-during-sync
Status: done
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-sync-pull-and-publish-commands.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Preserve Head-Of-Queue Order During Sync

- Tighten `pravaha queue sync` so queue processing stays strictly ordered by the
  ready-ref sequence.
- Stop candidate advancement at the first merge or validation failure instead of
  deleting the rejected ref and continuing with later ready refs in the same
  sync run.
- Keep later queue entries pending behind the first unresolved failing item so
  the validated queue tip cannot skip ahead of the queue head.
- Update queue tests to cover merge-failure and validation-failure cases where a
  broken head entry must block later ready refs from entering the validated tip.
