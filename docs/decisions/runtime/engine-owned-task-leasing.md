---
Kind: decision
Id: engine-owned-task-leasing
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Engine-Owned Task Leasing

- Keep task leasing as engine-owned runtime behavior in `v0.1`.
- Acquire the task lease and resolved worktree assignment before the first
  declared job step executes.
- Do not expose leasing through a user-authored `uses: core/lease-task` step.
- Treat removal of `core/lease-task` as a breaking change instead of carrying
  compatibility behavior for legacy flow definitions or persisted runtime step
  lists.
- Preserve the recorded lease time and worktree assignment in runtime records as
  engine-owned runtime state.
- Keep the `core/...` plugin namespace limited to bundled step handlers that are
  genuine flow-authored execution steps.

## Rationale

- Leasing already happens in the runtime before ordered step execution, so a
  fake plugin step adds user-visible surface area without adding behavior.
- Removing the fake step keeps the checked-in flow surface aligned with the
  actual execution boundary between engine-owned runtime setup and plugin-owned
  step execution.
- Breaking old `core/lease-task` references is preferable to carrying a fake
  plugin compatibility shim that hides the real runtime boundary.
