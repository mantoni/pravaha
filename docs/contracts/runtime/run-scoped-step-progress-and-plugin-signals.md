---
Kind: contract
Id: run-scoped-step-progress-and-plugin-signals
Status: done
Decided by:
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
  - docs/decisions/runtime/run-scoped-plugin-signal-emission.md
  - docs/decisions/runtime/generic-step-progress-persistence.md
Depends on:
  - docs/contracts/runtime/plugin-backed-ordered-step-execution.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Run-Scoped Step Progress

## Intent

- Persist ordered-step progress generically for the current run so Pravaha can
  resume from the first incomplete step without replaying completed earlier
  steps.

## Inputs

- The completed runtime persistence slice for unresolved attempts.
- The completed plugin-backed ordered step execution slice.
- Accepted decisions for pluggable plugins and generic ordered-step progress
  persistence.
- Jobs with ordered `run` and `uses` steps plus `next` evaluation over current
  plugin results and prior job outputs.

## Outputs

- Runtime persistence that records the current ordered-step position for every
  step kind in the run.
- Resume behavior that restarts at the first incomplete step for the current run
  and skips already completed earlier steps.
- A stable run-scoped identifier on plugin context for plugin-side idempotency.

## Side Effects

- Runtime records retain the ordered-step position strongly enough for resume
  and current flow evaluation.
- Plugin steps may still observe retries before their completion is durably
  recorded and must remain idempotent.
- Pravaha does not persist plugin-private observer state.

## Invariants

- One ordered-step persistence model applies to `run`, plugin, and worker steps.
- The runtime records the current ordered-step position before and after step
  execution strongly enough to resume from the first incomplete step.
- Resume never re-invokes steps already durably recorded as complete for the
  current run.
- The plugin context exposes one stable run-scoped idempotency identifier.
- Pravaha does not add durable plugin-private observer persistence in this
  slice.
- Strict unresolved-runtime blocking remains unchanged.

## Failure Modes

- Earlier completed ordered steps re-run after resume because progress was not
  durably recorded generically.
- Plugins depend on core-persisted observer state instead of managing their own
  private monitoring state.

## Review Gate

- Ordered-step persistence records progress for every step kind.
- Resume continues from the first incomplete step and does not replay completed
  earlier steps for the same run.
- Plugin context exposes a stable run-scoped idempotency identifier.
- Runtime records do not persist plugin-private observer state.
- `npm run all` passes.
