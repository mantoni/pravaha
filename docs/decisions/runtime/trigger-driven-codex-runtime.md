---
Kind: decision
Id: trigger-driven-codex-runtime
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Trigger-Driven Codex Runtime

- Use a trigger-driven runtime instead of a mandatory always-on daemon in
  `v0.1`.
- Keep a machine-local runtime store for transient execution state and expose it
  as a mixed graph together with checked-in Patram documents.
- Treat task documents as the leaseable execution unit and require one task per
  worktree at a time.
- Allow worktrees to be reusable, named, and long-lived, while keeping
  assignment and reuse engine-owned and expressing setup or cleanup through the
  ordinary ordered job step list.
- Make Codex a first-class worker family in `v0.1`.
- Require the chosen Codex backend to support locally supervised
  run-to-completion workers with strong local lifecycle control and
  observability.
- Keep crash recovery explicit after machine restart in `v0.1`.

## Rationale

- Trigger-driven runtime activation keeps Pravaha small when no work is running
  while still allowing local supervision when workers are active.
- A mixed graph keeps one query language across checked-in workflow state and
  machine-local runtime state.
- One task per worktree preserves isolation, observability, and retry semantics.
- Reusable worktrees reduce setup cost without weakening task-level ownership.
- First-class Codex support optimizes the first implementation around the real
  worker lifecycle instead of a premature generic adapter layer.
- Explicit crash recovery keeps the first version simple while avoiding daemon
  complexity.
