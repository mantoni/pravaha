---
Kind: contract
Id: job-level-worktree-policy
Status: done
Decided by:
  - docs/decisions/runtime/engine-owned-task-leasing.md
  - docs/decisions/runtime/engine-owned-worktree-assignment.md
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
Depends on:
  - docs/contracts/runtime/mixed-graph-flow-surface.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/worktree-lifecycle.md
  - docs/reference/runtime/pravaha-flow-examples.md
  - docs/reference/runtime/validation-examples.md
Root flow: docs/flows/runtime/job-level-worktree-policy.md
---

# Job-Level Worktree Policy

## Intent

- Move worktree choice into checked-in flow policy so one job declares one
  worktree assignment and reuse model, including exact named-slot selection.

## Inputs

- The completed mixed-graph flow surface slice.
- The accepted worktree lifecycle model for reusable, named, and long-lived
  worktrees.
- One interpreted runtime command surface for `reconcile` and `resume`.
- One machine-local runtime store that records resolved worktree assignments.

## Outputs

- One job-level `worktree` policy surface in flow documents.
- Validation for allowed worktree modes and job-scoped policy placement.
- Runtime support for `ephemeral` and exact-slot `named` worktree modes.
- Engine-owned lease acquisition and worktree preparation tied to the resolved
  job worktree policy.
- Resume behavior that reuses the exact recorded worktree assignment for the
  in-flight run.

## Side Effects

- Checked-in flow documents become the source of truth for worktree mode.
- Machine-local runtime state records the resolved worktree identity chosen for
  the job.
- Named worktree slots may persist across multiple runs when the job policy
  requests reuse.

## Invariants

- Worktree policy is declared at job scope only.
- One job instance owns one worktree lifecycle.
- Step-level worktree overrides are forbidden.
- `named` worktrees require the exact slot name in the checked-in flow.
- `ephemeral` worktrees remain runtime-created and disposable.
- Resume reuses the exact recorded worktree assignment for the recorded run.
- Pooled worktree selection is out of scope in `v0.1`.

## Supported Worktree Modes

- `ephemeral`: Create or resolve a disposable worktree for the current job run.
- `named`: Reuse the exact checked-in slot name declared by the job policy.
- Defer pooled allocation, slot arbitration, and fairness rules.

## Failure Modes

- Worktree mode remains machine-local policy and drifts away from checked-in
  flow semantics.
- Step handlers can override job worktree policy and break ownership and resume
  guarantees.
- Named worktree mode accepts ambiguous or missing slot names.
- Resume loses the resolved worktree identity and restarts in a different
  workspace.
- Engine-owned lease or worktree preparation semantics diverge between ephemeral
  and named worktrees without being visible in flow policy.

## Review Gate

- Flow validation accepts job-level worktree policy and rejects step-level
  overrides.
- `ephemeral` and exact-slot `named` modes are both executable.
- Named worktree runs reuse the declared slot consistently.
- Resume reuses the exact recorded worktree assignment.
- Existing reconcile, mixed-graph evaluation, and strict-resume invariants
  remain intact.
- `npm run all` passes.
