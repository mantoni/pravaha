---
Kind: contract
Id: codex-sdk-happy-path
Status: done
Decided by:
  - docs/decisions/runtime/codex-sdk-happy-path-backend.md
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/contracts/runtime/pravaha-flow-foundation.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/end-to-end-walkthrough.md
  - docs/reference/runtime/codex-backend-evaluation.md
---

# Codex SDK Happy Path

## Intent

- Prove one end-to-end SDK-backed task run through a hard-coded happy path
  before introducing a generic runtime engine.

## Inputs

- The completed repository foundation for flow documents, root-flow binding, and
  semantic config validation.
- One contract with one root flow and at least one task in a semantic `ready`
  state.
- One checked-in job-level worktree policy in the bound root flow.
- One Codex SDK invocation path with explicit prompt and working-directory
  control.

## Outputs

- One runtime entrypoint that selects and leases exactly one ready task for one
  contract.
- One flow-driven worktree assignment and preparation path for that leased task.
- One real Codex SDK invocation in that worktree with deterministic input.
- One observable runtime outcome with captured completion status and operator
  debug surface.
- One explicit task transition from `ready` to `review` on success or from
  `ready` to `blocked` on failure.
- Test coverage for success and failure of the hard-coded pipeline.

## Side Effects

- Machine-local runtime state for the leased task, worktree, worker run, and
  completion signal.
- Worktree creation or reuse during the task run.
- Checked-in task status changes when the run completes.

## Invariants

- One leased task occupies one worktree at a time.
- The checked-in root flow is the source of truth for worktree mode.
- The worker boundary is the Codex SDK, not a simulated completion path.
- The slice stays hard-coded and does not introduce a generic backend adapter or
  generic flow interpreter.
- Shared workflow mutations remain explicit and auditable.

## Failure Modes

- The runtime leases the wrong task or more than one task.
- The runtime invokes the SDK without stable working-directory context.
- The runtime cannot deterministically observe worker completion or failure.
- The runtime loses the checked-in task outcome after the worker run finishes.
- The runtime leaves worktrees or runtime records behind without a visible task
  outcome.

## Review Gate

- A fixture contract with a ready task can be run through the hard-coded path
  end to end.
- Tests cover success and failure outcome projection at the SDK boundary.
- The runtime leaves operator-visible evidence for the worker run outcome.
- `npm run all` passes.
