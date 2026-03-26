---
Kind: decision
Id: job-and-step-execution-semantics
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Job And Step Execution Semantics

- Reconcile flows through explicit triggers and keep manual resume after machine
  restart in `v0.1`.
- Fan out one job instance per document selected by `jobs.<name>.select`.
- Treat `needs` as a coarse scheduling barrier that waits for all upstream job
  instances to finish before the dependent job becomes eligible.
- In the single-flight scheduler-depth slice, treat an upstream job as finished
  enough when reconcile can find no runnable work for it under the current job
  semantics.
- Choose the next runnable job deterministically in flow declaration order and,
  for selected-task jobs, choose the next task deterministically in query result
  order.
- Keep single-flight runtime limits in force while adding scheduler depth: start
  at most one runtime attempt, keep at most one active lease, and keep at most
  one unresolved runtime record.
- Keep business-specific readiness and terminal checks in `if` and `await`
  expressions rather than encoding them into `needs`.
- Tie leasing to the configured semantic `ready` state and the configured
  dependency relation.
- Treat a leaseable unit as the document class configured by
  `roles.leaseable_unit_class`.
- Require one leased task or equivalent leaseable document per worktree at a
  time.
- Allow worktrees to be reusable, named, and long-lived, while keeping
  assignment and reuse engine-owned and expressing setup or cleanup through the
  ordinary ordered job step list.
- Treat worker runs as locally supervised run-to-completion processes.
- Treat `uses` as the primitive execution step form and `run` as sugar over
  `core/run`.
- Allow step handlers to emit implicit runtime graph state only.
- Require any checked-in Patram mutations to be declared explicitly through
  `transition` and `relate`.

## Rationale

- Trigger-driven reconciliation plus manual resume keeps the first runtime
  simple without losing durability.
- Coarse `needs` barriers make execution order legible without turning job
  dependencies into a second policy language.
- Gating leasing on semantic readiness preserves a strong scheduler invariant.
- One leased unit per worktree preserves isolation, observability, and retry
  semantics.
- Separating implicit runtime effects from explicit checked-in mutations keeps
  the flow language auditable and predictable.
