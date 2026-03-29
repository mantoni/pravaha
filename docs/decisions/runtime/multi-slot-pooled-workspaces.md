---
Kind: decision
Id: multi-slot-pooled-workspaces
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Multi-Slot Pooled Workspaces

- Extend repo-backed pooled worktree flow policy so one flow may declare
  multiple reusable workspace source ids in declaration order.
- Keep one flow instance bound to one concrete pooled worktree assignment at a
  time.
- Keep `workspace.source.id` as the single-slot form and add
  `workspace.source.ids` as the multi-slot form.
- Require exactly one of `workspace.source.id` or `workspace.source.ids`.
- Interpret `workspace.source.id` as equivalent to one-entry
  `workspace.source.ids`.
- Restrict multi-slot selection to repo-backed pooled worktrees.
- Select the first unoccupied pooled slot in declaration order during dispatch.
- Leave a matching flow instance unscheduled when every declared pooled slot is
  occupied.
- Persist the selected pooled slot in runtime state and reuse that exact slot on
  resume instead of selecting again.

## Rationale

- The existing pooled worktree model already treats worktree assignment as
  engine-owned runtime behavior.
- Allowing multiple declared pooled slots increases throughput without changing
  the operator-visible model that one run owns one concrete worktree.
- Declaration-order selection is deterministic, small in surface area, and
  sufficient for the current local dispatch runtime.
- Exact-slot resume preserves worktree affinity across approval waits,
  interruption, and restart.
