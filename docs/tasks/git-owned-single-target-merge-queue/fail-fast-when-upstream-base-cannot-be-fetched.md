---
Kind: task
Id: fail-fast-when-upstream-base-cannot-be-fetched
Status: done
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/tasks/git-owned-single-target-merge-queue/add-queue-sync-pull-and-publish-commands.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Fail Fast When Upstream Base Cannot Be Fetched

- Narrow queue base resolution so Pravaha falls back to the local target branch
  only when the configured upstream remote is genuinely absent from the repo.
- Treat upstream fetch failures, authentication failures, and transport errors
  as queue-sync failures instead of silently rebuilding from the local branch.
- Keep queue initialization, sync, and publish behavior explicit about whether
  the validated queue tip is based on fetched upstream state or local-only
  state.
- Add tests that simulate a configured but unreachable upstream remote and
  verify that queue operations fail without publishing or advancing the
  validated queue tip.
