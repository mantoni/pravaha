---
Kind: contract
Id: single-task-flow-reconciler
Status: done
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/end-to-end-walkthrough.md
---

# Single-Task Flow Reconciler

## Intent

- Add the first interpreted reconciler that reads one contract root flow and
  processes at most one eligible task per invocation through the checked-in flow
  surface.

## Inputs

- Patram library query support through `loadProjectGraph` and `queryGraph`.
- One contract that references exactly one root flow.
- One root flow with one supported job shape.
- Zero or more task documents tracked in the contract.
- Repo semantic role and state mappings from `pravaha.json`.

## Outputs

- One interpreted runtime entrypoint such as `pravaha reconcile`.
- One Patram-backed graph loading path that uses library imports instead of
  shelling out to the Patram CLI.
- One interpreted execution path for one supported job in the root flow.
- One eligibility check that combines semantic role selection, semantic `ready`
  state filtering, and dependency filtering for blocked prerequisites.
- One deterministic selection rule that picks the first eligible task in query
  result order.
- One reconcile run that processes at most one eligible task per invocation.
- One explicit task outcome projected back into checked-in workflow state.

## Side Effects

- Machine-local runtime state for the selected task, lease, worktree, worker
  run, and completion signal.
- One checked-in task state transition on worker completion.
- Operator-visible output that identifies the selected task and worker outcome.

## Invariants

- The reconciler processes at most one eligible task per invocation.
- If multiple tasks are eligible, the reconciler picks the first task in query
  result order.
- The reconciler reads the checked-in root flow instead of using a bespoke
  hard-coded selection path.
- The reconciler uses Patram library APIs instead of invoking `patram` as a
  child process.
- Shared workflow mutations remain explicit and auditable.

## Supported Flow Surface

- Support one contract root flow at a time.
- Support one job per flow in the first interpreted slice.
- Support `select` through the currently validated semantic-role shape such as
  `select.role`.
- Support runtime-owned readiness and dependency filtering outside the flow
  document.
- Support `uses`, `await`, and `transition`.
- Support task-targeted transitions through the current validated state shape
  such as `transition.to`.
- Defer generic query-shaped `select`, explicit transition targets, dependency
  barriers across jobs, and multi-job scheduling.

## Failure Modes

- The reconciler still depends on the Patram CLI path and cannot use the new
  library query surface.
- The reconciler ignores the checked-in flow and still behaves like a bespoke
  command.
- The reconciler selects more than one task or selects tasks
  nondeterministically.
- The reconciler interprets unsupported flow shapes without rejecting them
  clearly.
- The reconciler cannot map interpreted worker outcomes back into checked-in
  task state.
- The reconciler loses operator visibility into which task was selected and why
  the run succeeded or failed.

## Review Gate

- The repo depends on a Patram version that exports `loadProjectGraph` and
  `queryGraph`.
- The interpreted reconciler uses the Patram library API instead of a CLI
  subprocess.
- A fixture contract with multiple ready tasks results in exactly one processed
  task per invocation.
- Selection order is deterministic and covered by tests.
- The interpreted reconciler reads the contract root flow from the checked-in
  repo model.
- Success and failure outcomes still project explicit task transitions.
- `npm run all` passes.
