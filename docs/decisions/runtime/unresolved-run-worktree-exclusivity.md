---
Kind: decision
Id: unresolved-run-worktree-exclusivity
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Unresolved Run Worktree Exclusivity

- Treat every unresolved run that has a resolved reusable worktree assignment as
  the exclusive owner of that worktree until the run reaches a terminal outcome
  or performs an explicit handoff.
- Keep worker availability separate from worktree availability. A worker may
  accept other assignments while one of its earlier runs still owns a reusable
  worktree.
- Reconstruct occupied reusable worktrees from unresolved run snapshots and the
  checked-in flow workspace policy during scheduling and dispatcher takeover.
- Do not persist a separate durable worktree-lock record in `v0.1`.
- Keep approval waits, queue waits, and future resumable non-terminal outcomes
  under the same exclusivity rule.

## Rationale

- Reusable worktrees are part of resumable execution state, so reusing one
  before its owning run becomes terminal can destroy the state required for
  resume.
- Separating worker and worktree availability keeps the dispatcher aligned with
  the long-term merge-queue model instead of baking in one-assignment-per-worker
  as a correctness boundary.
- Reconstructing occupancy from unresolved run snapshots preserves takeover and
  crash recovery without introducing a second persistence model for live locks.
