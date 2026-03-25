---
Kind: contract
Id: strict-runtime-resume
Status: done
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
  - docs/decisions/runtime/codex-sdk-happy-path-backend.md
Depends on:
  - docs/contracts/runtime/single-task-flow-reconciler.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/runtime-node-model.md
  - docs/reference/runtime/end-to-end-walkthrough.md
Root flow: docs/flows/runtime/strict-runtime-resume.md
---

# Strict Runtime Resume

## Intent

- Add machine-local runtime persistence and strict manual resume so Pravaha can
  survive interruption without silently abandoning or replacing in-flight work.

## Inputs

- The completed single-task interpreted reconciler.
- One machine-local runtime store for flow instance, lease, worktree, and worker
  state.
- One unresolved or completed runtime record model with explicit local outcome
  fields.
- One operator-triggered command surface for `reconcile` and `resume`.

## Outputs

- One persisted machine-local runtime record for each interpreted run.
- One blocking rule that prevents `pravaha reconcile` from selecting new work
  while unresolved local runtime state exists.
- One explicit `pravaha resume` path bound to the exact recorded task and run
  context.
- One terminal local outcome model that marks runtime state as resolved only
  when the run reaches a terminal outcome.
- Test coverage for blocked reconcile, successful resume, and failed resume.

## Side Effects

- Machine-local records for flow instance, lease, worktree assignment, worker
  run, and local completion state.
- Operator-visible failure when reconcile is blocked by unresolved runtime
  state.
- Continued use of the recorded worktree and task context during resume.

## Invariants

- Any runtime record without a terminal local outcome is unresolved.
- Unresolved runtime state blocks `pravaha reconcile`.
- `pravaha resume` is bound to the exact recorded task, flow instance, lease,
  and worktree.
- Resume does not re-evaluate task eligibility or select a different task.
- No automatic recovery, stale-run expiration, heartbeat, or liveness probing is
  required in `v0.1`.
- Shared workflow mutations remain explicit and auditable.

## Runtime Record Semantics

- Persist enough state to identify:
  - contract
  - root flow
  - selected task
  - lease time
  - worktree path
  - worker thread or run identity
  - local outcome state
- Treat local outcomes as:
  - unresolved while no terminal local outcome is recorded
  - resolved when a terminal success or failure outcome is recorded
- Block new reconcile work whenever any unresolved runtime record exists.

## Failure Modes

- Reconcile ignores unresolved runtime state and starts new work anyway.
- Resume re-runs selection logic and attaches to a different task.
- Runtime persistence is too weak to identify the exact recorded run context.
- Operators cannot tell why reconcile is blocked or what run must be resumed.
- Completed runs remain unresolved and permanently block new work.

## Review Gate

- `pravaha reconcile` refuses to start new work when an unresolved runtime
  record exists.
- `pravaha resume` continues only the exact recorded task and run context.
- Resume does not re-select tasks.
- Terminal local outcomes unblock future reconcile runs.
- Tests cover interrupted-run persistence, blocked reconcile, and strict resume.
- `npm run all` passes.
