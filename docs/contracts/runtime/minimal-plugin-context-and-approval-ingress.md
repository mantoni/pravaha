---
Kind: contract
Id: minimal-plugin-context-and-approval-ingress
Status: proposed
Decided by:
  - docs/decisions/runtime/minimal-curated-plugin-context.md
  - docs/decisions/runtime/approval-only-command-ingress.md
  - docs/decisions/runtime/run-scoped-plugin-signal-emission.md
Depends on:
  - docs/contracts/runtime/plugin-backed-ordered-step-execution.md
  - docs/contracts/runtime/run-scoped-step-progress-and-plugin-signals.md
  - docs/contracts/runtime/strict-runtime-resume.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Minimal Plugin Context And Approval Ingress

## Intent

- Stabilize the minimal public `v0.1` plugin `context` contract while adding one
  built-in approval primitive and one matching run-scoped CLI ingress path.

## Inputs

- The completed plugin-backed ordered-step execution slice.
- The completed run-scoped plugin signal and step-progress slice.
- The completed strict runtime resume slice.
- Accepted decisions for the curated plugin context, approval-only ingress, and
  run-scoped plugin signal emission.

## Outputs

- A curated stable plugin `context` contract limited to `run_id`,
  `repo_directory`, `worktree_path`, parsed `with`, bound `document` and `task`
  metadata when available, `emit(kind, payload)`, and a console helper.
- One built-in pending interaction primitive on plugin `context`:
  `await context.requestApproval()`.
- One built-in CLI ingress path: `pravaha approve --token <run_id>`.
- Runtime behavior that re-enters plugin `run(context)` on resume so plugins may
  re-register approval waiting idempotently.
- Standard operator-facing approval output printed by Pravaha when a plugin
  requests approval.

## Side Effects

- Plugin-backed approval remains one ordinary `uses` step lifecycle instead of a
  `uses` step plus a separate workflow `await` step.
- Approval routing stays run-scoped and uses the current run id as the operator
  token.
- Plugins remain responsible for any local file watching or other observation
  they require.

## Invariants

- Pravaha exposes only the curated stable plugin `context` fields in this slice.
- Pravaha does not expose a broad runtime object on plugin `context`.
- Pravaha does not preload full workflow document contents into plugin
  `context`.
- Pravaha does not expose a file-watch API or a broad observer API on plugin
  `context`.
- `context.requestApproval()` is argument-free in `v0.1`.
- Approval stays one plugin-backed step lifecycle and does not introduce a
  separate built-in `await` workflow step.
- Approval tokens are run-scoped and not step-scoped.
- Resume and restart re-enter `run(context)` and do not persist plugin callback
  registrations or plugin-private observer state.
- Strict unresolved-runtime blocking and existing step-progress semantics remain
  intact.

## Failure Modes

- Plugins receive a broad runtime object and couple to unstable runtime
  internals.
- Plugins depend on preloaded full document bodies instead of explicit bindings
  and local file reads.
- Approval is split across separate `uses` and `await` step mechanics.
- Approval ingress targets a step id instead of the unresolved run id.
- Resume skips plugin re-entry and previously pending approval steps cannot
  complete idempotently.
- Core runtime starts persisting plugin-private observers or exposes a generic
  file-watch API too early.

## Review Gate

- Plugins receive the curated stable `context` fields and no broad runtime
  object.
- `context.requestApproval()` prints standard approval instructions from Pravaha
  and keeps the plugin step unresolved until approval arrives.
- `pravaha approve --token <run_id>` routes approval to the matching unresolved
  run.
- After approval ingress, resume re-enters `run(context)` and the plugin-backed
  step completes without a separate workflow `await` step.
- Plugin `context.emit(...)` continues to work with the same run-scoped signal
  behavior.
- No file-watch API or broad observer surface is added to plugin `context`.
- `npm run all` passes.
