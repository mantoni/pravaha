---
Kind: decision
Id: engine-owned-worktree-assignment
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Engine-Owned Worktree Assignment

- Keep worktree selection, creation, reuse, and deletion as engine-owned runtime
  behavior in `v0.1`.
- Resolve and prepare the assigned worktree before the first declared job step
  executes.
- Do not expose worktree assignment or preparation through a bundled
  `uses: core/setup-worktree` step.
- Treat removal of `core/setup-worktree` as a breaking checked-in flow surface
  change instead of carrying a compatibility shim for a fake plugin.
- Preserve the resolved worktree identity and path in runtime records as
  engine-owned runtime state.
- Keep room for explicit project setup or cleanup through ordinary `run` steps
  or genuine plugins that operate inside the already-assigned worktree.

## Rationale

- The runtime already prepares worktrees before ordered step execution, so a
  fake `core/setup-worktree` step adds user-visible surface area without adding
  behavior.
- Keeping worktree assignment on the engine side preserves a clean boundary
  between machine-local runtime mechanics and checked-in execution policy.
- Removing the fake bundled step makes runtime examples and defaults match the
  actual execution model and leaves setup semantics to ordinary ordered steps.
