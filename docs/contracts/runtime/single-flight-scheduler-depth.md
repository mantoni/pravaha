---
Kind: contract
Id: single-flight-scheduler-depth
Status: done
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/contracts/runtime/single-task-flow-reconciler.md
  - docs/contracts/runtime/strict-runtime-resume.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-flow-examples.md
---

# Single-Flight Scheduler Depth

## Intent

- Add deterministic scheduler depth for flows that declare multiple jobs and
  coarse job-level `needs` barriers while keeping the runtime single-flight.

## Inputs

- The completed single-task interpreted reconciler slice.
- The completed strict unresolved-runtime resume slice.
- The accepted job and step execution semantics decision.
- Root flows that may declare multiple jobs in one contract scope.

## Outputs

- Flow interpretation that accepts multiple jobs in declaration order.
- Job-level `needs` validation and execution semantics for coarse barriers.
- Reconcile behavior that chooses at most one next runnable job or task per
  invocation.
- Runtime support that keeps one unresolved runtime record and one worker run as
  the maximum active footprint.
- Backward compatibility for existing single-job flows.

## Side Effects

- Downstream jobs may become eligible only after upstream jobs are exhausted
  under the current scheduler rules.
- Contract-level jobs without `select` may run only when their `needs` barriers
  are satisfied and their explicit transition would still change durable state.

## Invariants

- Reconcile starts at most one runtime attempt per invocation.
- Unresolved runtime state still blocks new reconcile work before scheduling.
- The scheduler chooses the first runnable job in flow declaration order.
- Selected-task jobs still choose the first eligible task in query result order.
- `needs` does not introduce concurrent worker runs, multiple active leases, or
  multiple unresolved runtime records.

## Scheduler Rules

- `needs` is a coarse barrier over named upstream jobs.
- A selected-task job remains runnable while it still exposes an eligible task
  under the runtime ready-state and dependency filter.
- A downstream job becomes eligible only after every named upstream job is
  exhausted, meaning reconcile can find no runnable work for that upstream job.
- Jobs without `select` stay narrow in this slice: they may gate on job-level
  `if` and perform one explicit document transition without starting a worker.

## Failure Modes

- Multi-job flows load but schedule jobs nondeterministically.
- A bad `needs` reference fails late or silently.
- Downstream jobs run while upstream jobs still expose runnable work.
- The scheduler depth slice regresses single-flight runtime blocking or resume.
- Existing single-job task flows stop reconciling exactly as before.

## Review Gate

- Valid multi-job flows with `needs` load successfully.
- Invalid `needs` references fail clearly in validation or interpretation.
- Downstream jobs stay blocked until upstream jobs are exhausted.
- Reconcile still starts at most one runtime attempt.
- Existing single-job flows still pass unchanged.
- `npm run all` passes.
