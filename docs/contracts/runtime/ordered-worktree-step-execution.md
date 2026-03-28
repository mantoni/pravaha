---
Kind: contract
Id: ordered-worktree-step-execution
Status: done
Decided by:
  - docs/decisions/runtime/engine-owned-task-leasing.md
  - docs/decisions/runtime/engine-owned-worktree-assignment.md
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/contracts/runtime/job-level-worktree-policy.md
  - docs/contracts/runtime/single-flight-scheduler-depth.md
  - docs/contracts/runtime/strict-runtime-resume.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-flow-examples.md
---

# Ordered Worktree Step Execution

## Intent

- Execute one job as one ordered step list inside the job's assigned worktree
  without introducing special worktree lifecycle phases.

## Inputs

- The completed job-level worktree policy slice.
- The completed scheduler-depth slice with single-flight job ordering.
- The completed strict unresolved-runtime resume slice.
- Root flows that declare ordinary `uses`, `run`, `await`, `if`, and
  `transition` steps.

## Outputs

- Flow interpretation that preserves the declared step order for selected-task
  jobs.
- Runtime support for ordinary `run` and `uses` steps executed inside the
  assigned worktree.
- Runtime support that acquires the task lease and resolves the assigned
  worktree before the first declared step runs.
- Runtime support that stops a job on the first failing step.
- Runtime behavior that leaves the assigned worktree in place for operator
  inspection after failure.

## Side Effects

- Worktree policy continues to choose assignment or reuse mode only.
- Task leasing remains engine-owned runtime behavior rather than a checked-in
  flow step.
- Flow authors may express setup and cleanup as ordinary steps in the same job
  step list.
- Named worktrees may accumulate operator-visible state across runs when the job
  reuses the same slot.

## Invariants

- Worktree policy remains job-scoped and limited to assignment or reuse mode.
- Selected-task job steps execute in the exact declared order.
- `run` and `uses` are both ordinary executable steps in the same ordered list.
- Task leasing and initial worktree assignment stay outside the declared step
  list.
- There is no special `worktree.prepare`, `worktree.cleanup`, or equivalent
  lifecycle phase in this slice.
- A failing step halts the job immediately.
- The runtime does not auto-heal, auto-reset, or auto-clean the assigned
  worktree in this slice.
- Single-flight reconcile and strict resume invariants remain in force.

## Step Execution Rules

- Acquire the task lease and resolve the job worktree once from the declared job
  policy before executing ordinary steps.
- Execute every supported ordinary step inside that assigned worktree.
- Treat `run` as a normal shell-command step and `uses` as a normal handler
  step.
- Continue to evaluate `await`, `if`, `transition`, and `relate` according to
  the interpreted step list rather than through special worktree phases.
- Stop at the first failing `run` or `uses` step and keep the worktree as-is for
  operator intervention.

## Failure Modes

- The runtime still hard-codes setup, worker, and cleanup as special phases
  instead of respecting declared step order.
- `run` steps execute outside the assigned worktree or are ignored entirely.
- Failure in an ordinary step still triggers automatic worktree cleanup or
  reset.
- Existing single-flight or resume semantics regress while broadening the step
  surface.
- Unsupported step shapes fail late or with unclear validation messages.

## Review Gate

- Selected-task jobs may place ordinary `run` steps before or after worker
  execution.
- Step order is preserved exactly as declared.
- A failing ordinary step halts the job and leaves the assigned worktree in
  place.
- Existing single-task runtime flows still execute successfully.
- Unsupported step shapes fail with clear interpretation or validation errors.
- `npm run all` passes.
