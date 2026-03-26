---
Kind: contract
Id: runtime-node-lifecycle
Status: proposed
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/contracts/runtime/job-level-worktree-policy.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/runtime-node-model.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/end-to-end-walkthrough.md
Root flow: docs/flows/runtime/runtime-node-lifecycle.md
---

# Runtime Node Lifecycle

## Intent

- Stabilize the lifecycle semantics of reserved machine-local runtime nodes so
  flows can query the current run predictably without depending on arbitrary
  historical local state.

## Inputs

- The completed mixed-graph flow surface slice.
- The completed job-level worktree policy slice.
- The current machine-local runtime store for flow instances, leases, worktrees,
  workers, and signals.
- The accepted runtime node model and mixed-graph architecture references.

## Outputs

- Stable lifecycle rules for `$flow_instance`, `$lease`, `$worktree`, `$worker`,
  and `$signal`.
- Runtime support that keeps active execution nodes queryable while a run is in
  progress.
- Runtime support that keeps only the current terminal run snapshot queryable
  until a later matching run replaces it or the local record is otherwise
  cleared.
- Validation and execution semantics that prevent flows from depending on
  arbitrary stale local history.
- No dedicated operator-facing inspection or cleanup surface in this slice.

## Side Effects

- Mixed-graph queries gain a more explicit contract for what runtime nodes may
  exist at each stage of a run.
- Terminal signal records may remain queryable after run completion only as the
  current matching run snapshot.
- Short-lived execution nodes remain machine-local operational state rather than
  long-lived history.

## Invariants

- Active runtime nodes remain queryable during the active run they describe.
- `$signal` terminal outcomes remain queryable only as the current matching run
  snapshot.
- `$flow_instance` for the current run remains queryable only as the current
  matching run snapshot.
- `$lease` and `$worker` do not become arbitrary long-lived historical records.
- Flows may observe the current run and its terminal signals but must not depend
  on unrelated old local runtime state.
- Ambiguous matching runtime records fail closed instead of exposing arbitrary
  retained local history.
- Strict unresolved-runtime blocking and exact-task resume semantics remain in
  force.

## Runtime Node Semantics

- `$flow_instance`: Represents the current local execution context for one
  contract-bound run and remains queryable while active or as the retained
  current terminal snapshot.
- `$lease`: Represents active lease ownership for the current in-flight task and
  may disappear after the run resolves.
- `$worktree`: Represents the resolved worktree assignment for the current run
  and remains queryable while the run is active.
- `$worker`: Represents the active worker run and may disappear after the run
  resolves.
- `$signal`: Represents runtime events, including terminal completion outcomes,
  and terminal completion outcomes remain queryable only as the retained current
  run snapshot.

## Failure Modes

- Runtime nodes disappear too early for `await`, `if`, or resume semantics to
  work reliably.
- Runtime nodes linger without replacement rules and flows start depending on
  stale local history instead of only the current run snapshot.
- Multiple retained matches make the current run ambiguous but the runtime does
  not fail closed.
- The runtime node model diverges between actual execution and the mixed-graph
  contract exposed to flows.

## Review Gate

- Active runtime nodes are queryable during an in-flight run.
- Terminal completion signals remain queryable only as the current retained run
  snapshot.
- Flows can observe the current run and terminal signals without depending on
  arbitrary historical runtime nodes.
- Later matching runs replace the retained terminal snapshot when the current
  run is unambiguous.
- Ambiguous matching runtime records fail closed.
- Existing reconcile, resume, and worktree-policy behavior remain intact.
- `npm run all` passes.
