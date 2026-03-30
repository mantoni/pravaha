---
Kind: contract
Id: job-state-machine-execution
Status: proposed
Decided by:
  - docs/decisions/runtime/job-state-machine-flow-shape.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
Depends on:
  - docs/contracts/runtime/pravaha-flow-foundation.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
---

# Job State-Machine Execution

## Intent

- Replace the step-list and `needs` scheduler surface with one durable
  single-chain job state machine per matched trigger document.

## Example Shape

```yaml
workspace:
  id: app

on:
  patram: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/run-codex
    with:
      prompt: Implement ${{ task.path }}.
      reasoning: medium
    next: test

  test:
    uses: core/run
    with:
      command: npm test
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: done
      - goto: fix

  fix:
    uses: core/run-codex
    limits:
      max-visits: 3
    next: test

  done:
    end: success
```

## Inputs

- The completed repository foundation for checked-in flow documents and
  contract-bound root flows.
- The completed current-truth run-snapshot persistence slice.
- The accepted job state-machine flow shape decision.
- Root flows that declare one flow-level `workspace`, one root-level `on`
  binding, and `jobs` entries shaped as executable `uses` nodes or terminal
  `end` nodes.

## Outputs

- Flow validation that accepts only the job state-machine surface for migrated
  flows.
- Runtime interpretation that enters the first declared job as the flow instance
  entrypoint.
- Runtime support that executes exactly one `uses` node per job visit and then
  evaluates `next` against the current `result` and prior job outputs.
- Runtime support that chooses exactly one successor job or terminal end after
  each completed visit.
- Runtime support that records the latest completed outputs for each visited job
  and exposes them as `jobs.<name>.outputs`.
- Runtime support that enforces node-local visit limits such as
  `limits.max-visits`.
- Runtime support that resolves one flow-level workspace contract for the whole
  durable chain through one referenced global workspace id and reuses that
  concrete directory across loops in the same flow instance.
- Runtime support that checkpoints current durable execution truth after each
  completed job visit and at every persistent wait or terminal outcome.
- Clear validation and runtime failures when a flow relies on removed
  step-surface constructs.

## Side Effects

- Repeated visits such as `fix -> test -> fix` may accumulate operator-visible
  state in the same workspace materialization for the life of the flow instance.
- Human review, approval, waiting, checked-in workflow mutation, and downstream
  dispatch remain ordinary plugin behavior rather than special engine syntax.
- Reordering declared jobs changes the flow entrypoint because the first
  declared job is the starting node.
- A node with no matching `next` branch terminates the flow instance as an
  implicit failure even when the plugin visit itself completed normally.

## Invariants

- Root-level `on` remains the only fan-out surface. Each matched document
  creates one durable flow instance.
- The runtime evaluates at most one active job visit at a time for one flow
  instance.
- Every non-terminal job declares exactly one `uses` target.
- Every non-terminal job declares `next`.
- Every terminal job declares only `end`.
- `next` chooses exactly one successor or ends in implicit failure when no
  branch matches.
- `next` branch evaluation uses the current visit through dedicated `result` and
  never through `jobs.<current>.outputs`.
- `jobs.<name>.outputs` always describes the latest completed visit for that job
  in the current flow instance.
- Recoverable plugin outcomes remain data for branch evaluation rather than a
  hidden engine control path.
- `limits.max-visits` counts visits per named job within one flow instance.
- Workspace policy is flow-scoped rather than job-scoped.
- Flow workspace declarations contain only `workspace.id`.
- Global `pravaha.json` owns lifecycle mode, placement, and checkout semantics
  for each workspace id.
- One flow instance owns at most one resolved workspace materialization at a
  time.
- Interruption may lose in-flight worker execution, but the durable run snapshot
  preserves the latest completed job boundary.
- Flows in this slice do not declare `steps`, `needs`, `await`, `transition`,
  `relate`, job-scoped `worktree`, or job-scoped `select`.

## Validation Rules

- Require at least one declared job. The first declared job is the entrypoint.
- Require every `goto` target in `next` to reference an existing job name.
- Require ordered branch lists in `next` to contain at least one branch.
- Allow one bare string `next` target as unconditional control flow.
- Allow branch entries in `next` to omit `if` only for the intended fallback
  branch.
- Reject non-terminal jobs that omit `uses` or `next`.
- Reject terminal jobs that combine `end` with `uses`, `with`, `limits`, or
  `next`.
- Reject flows that mix this surface with removed step-surface fields.
- Reject flow workspace shapes that declare fields beyond `workspace.id`.

## Runtime Rules

- Resolve the flow-level workspace once for the new flow instance before the
  first job visit executes by looking up the referenced global workspace id.
- Enter the first declared job for the new flow instance.
- Execute the job's one declared plugin with parsed `with` inputs inside the
  resolved workspace context when a workspace exists.
- Bind the completed visit payload to `result` while evaluating the current
  job's `next`.
- Expose only prior completed job visits through `jobs.<name>.outputs` during
  branch evaluation.
- Evaluate branch lists in declaration order and take the first matching branch.
- Persist the current job's outputs and visit counts as the latest durable
  checkpoint only after the job visit completes and before the chosen successor
  begins.
- Fail the flow instance clearly when no `next` branch matches.
- Fail the flow instance clearly when a job exceeds its configured visit limit.
- Re-enter after interruption from the latest durable checkpoint or wait state
  instead of from mid-visit worker-session state.

## Failure Modes

- The runtime still treats jobs as ordered step containers instead of one-node
  state-machine states.
- Migrated flows may still declare `needs` or other removed step-surface fields.
- Branch evaluation reads stale current-job outputs through
  `jobs.<current>.outputs` instead of using dedicated `result`.
- Looping jobs do not update their latest outputs correctly and downstream
  branches read stale data.
- Workspace resolution happens per node visit instead of once per durable flow
  instance.
- Visit counts are not checkpointed durably and bounded retry loops become
  incorrect after interruption.
- A no-match `next` case hangs or silently falls through instead of failing
  explicitly.
- Visit limits are ignored and retry loops can run without a checked-in bound.

## Review Gate

- Valid state-machine flows load successfully with one flow-level `workspace`,
  one root-level `on`, and node-shaped `jobs`.
- Invalid `goto` targets fail clearly in validation or interpretation.
- Flows that still declare `steps`, `needs`, `await`, `transition`, `relate`, or
  job-level `worktree` fail clearly.
- The first declared job runs as the entrypoint.
- `next` sees the current visit through `result` and prior visits through
  `jobs.<name>.outputs`.
- A repeated visit overwrites the named job's latest outputs for later branch
  evaluation.
- A no-match `next` case fails the flow instance clearly.
- `limits.max-visits` stops bounded retry loops after the configured number of
  visits.
- One flow instance reuses one resolved workspace materialization across loops.
- Completed job visits are durably checkpointed before the next job begins.
- `npm run all` passes.
