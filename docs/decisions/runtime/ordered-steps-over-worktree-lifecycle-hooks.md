---
Kind: decision
Id: ordered-steps-over-worktree-lifecycle-hooks
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Ordered Steps Over Worktree Lifecycle Hooks

- Keep `jobs.<name>.worktree` limited to engine-owned assignment and reuse
  policy in `v0.1`.
- Do not add flow-level `prepare` or `cleanup` lifecycle hooks for worktrees in
  `v0.1`.
- Execute each job as one ordered step list inside the assigned worktree.
- Express setup, teardown, review requests, and other interaction mechanics as
  ordinary `uses` or `run` steps.
- Halt job execution on the first failing step and leave the assigned worktree
  in place for the operator.
- Keep worktree creation, selection, reuse, and deletion as engine concerns
  determined by the declared worktree mode.
- Keep named worktrees reusable without introducing a remembered machine-local
  `broken` state in `v0.1`.

## Rationale

- Ordinary ordered steps keep the flow surface smaller and more uniform than
  introducing special lifecycle hooks.
- Leaving assignment and reuse mechanics in the engine preserves a clean
  boundary between checked-in policy and machine-local operational concerns.
- Stopping on failure and leaving the worktree intact keeps operator recovery
  explicit without forcing premature auto-heal semantics into the runtime.
- Deferring remembered worktree health state keeps the first reusable-worktree
  model simple until real failure patterns justify more machinery.
