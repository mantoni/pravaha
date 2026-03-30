---
Kind: contract
Id: multi-slot-pooled-workspaces
Status: done
Decided by:
  - docs/decisions/runtime/multi-slot-pooled-workspaces.md
Depends on:
  - docs/contracts/runtime/job-level-worktree-policy.md
  - docs/contracts/runtime/job-state-machine-execution.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/worktree-lifecycle.md
---

# Multi-Slot Pooled Workspaces

## Intent

- Allow one repo-backed pooled workspace policy to declare multiple reusable
  worktree source ids and let dispatch choose any free slot.

## Inputs

- The completed job-level worktree policy slice.
- The accepted worktree lifecycle model for pooled worktrees.
- The accepted multi-slot pooled workspaces decision.
- State-machine flows that declare one flow-level repo-backed pooled workspace.

## Outputs

- Flow validation that accepts `workspace.source.id` or `workspace.source.ids`
  for repo-backed worktree flows.
- Flow interpretation that normalizes single-slot and multi-slot pooled source
  ids into one ordered candidate list.
- Dispatch behavior that chooses the first unoccupied pooled slot in declaration
  order and suppresses scheduling when all candidates are occupied.
- Assignment payloads that carry one concrete pooled workspace selection into
  attempt execution.
- Runtime records that persist the chosen pooled slot for unresolved runs.
- Resume behavior that reuses the recorded pooled slot exactly.

## Side Effects

- Declaration order becomes the checked-in tie-breaker for pooled slot
  selection.
- Operators may add or remove pooled capacity by editing the checked-in source
  id list.
- Matching work may remain queued locally while all declared pooled slots are
  occupied.

## Invariants

- One flow instance owns at most one concrete workspace assignment at a time.
- `workspace.source.id` and `workspace.source.ids` are mutually exclusive.
- `workspace.source.ids` contains only unique non-empty strings.
- Multi-slot selection applies only to `source.kind: repo` plus
  `materialize.kind: worktree` plus `materialize.mode: pooled`.
- Resume never re-selects a pooled slot for an unresolved run.
- Pooled slot selection remains engine-owned runtime behavior rather than a
  flow-authored step.

## Validation Rules

- Accept one non-empty `workspace.source.id`.
- Accept one non-empty unique `workspace.source.ids` array.
- Reject flows that declare both `workspace.source.id` and
  `workspace.source.ids`.
- Reject empty or duplicate entries in `workspace.source.ids`.

## Runtime Rules

- Expand the declared pooled source ids into ordered candidate pooled worktree
  identities.
- Exclude identities already occupied by unresolved runs.
- Reserve the selected identity during assignment materialization so one
  dispatch pass does not double-book the same pooled slot.
- Prepare the concrete selected pooled worktree before the first job visit.
- Persist the selected pooled slot into runtime state for unresolved and final
  outcomes.
- Rebuild resume context from the recorded pooled slot rather than from a fresh
  slot selection.

## Failure Modes

- Validation accepts ambiguous pooled source declarations.
- Dispatch creates duplicate assignments for the same pooled slot in one pass.
- Resume returns to a different pooled slot than the one used before
  interruption.
- A multi-slot pooled flow produces multiple simultaneous assignments for one
  matched document instead of one assignment with one selected slot.

## Review Gate

- Valid pooled flows load with either `workspace.source.id` or
  `workspace.source.ids`.
- Invalid pooled flows that mix `id` and `ids` fail clearly.
- Dispatch skips an occupied earlier slot and chooses a later free slot.
- Dispatch leaves a matching flow instance unscheduled when all declared pooled
  slots are occupied.
- Resume reuses the recorded pooled slot exactly.
- `npm run all` passes.
