---
Kind: contract
Id: minimal-plugin-context-and-approval-ingress
Status: proposed
Decided by:
  - docs/decisions/runtime/bundled-core-plugins-own-implementations.md
  - docs/decisions/runtime/minimal-curated-plugin-context.md
  - docs/decisions/runtime/approval-only-command-ingress.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
Depends on:
  - docs/contracts/runtime/plugin-backed-ordered-step-execution.md
  - docs/contracts/runtime/run-scoped-step-progress-and-plugin-signals.md
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Minimal Plugin Context And Approval Ingress

## Intent

- Stabilize the minimal public `v0.1` plugin `context` contract while adding one
  built-in approval primitive and one matching run-scoped CLI ingress path
  backed by the canonical durable run snapshot.

## Inputs

- The completed plugin-backed ordered-step execution slice.
- The completed run-scoped plugin signal and step-progress slice.
- The current runtime persistence and checkpoint re-entry semantics used by the
  worker pool.
- Accepted decisions for the curated plugin context, approval-only ingress, and
  current-truth run snapshot persistence.

## Outputs

- A curated stable plugin `context` contract limited to `run_id`,
  `repo_directory`, `worktree_path`, parsed `with`, bound `document` and `task`
  metadata when available, `dispatchFlow({...})`, and a console helper.
- One built-in pending interaction primitive on plugin `context`:
  `await context.requestApproval()`.
- One built-in CLI ingress path: `pravaha approve --token <run_id>`.
- Runtime behavior that persists approval wait state inside the matching run
  snapshot and continues from that durable wait boundary after approval.
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
- Pravaha does not expose `context.emit(...)` or plugin signal schemas in this
  slice.
- Pravaha does not expose a general subprocess or process-launch API on plugin
  `context`.
- `context.requestApproval()` is argument-free in `v0.1`.
- Approval stays one plugin-backed step lifecycle and does not introduce a
  separate built-in `await` workflow step.
- Approval tokens are run-scoped and not step-scoped.
- Approval wait state is persisted in the canonical run snapshot rather than in
  callback registration state or a separate signal record.
- Re-entry after approval starts from the durable wait boundary rather than from
  in-flight callback state.
- Existing step-progress semantics remain compatible with the narrower
  current-truth snapshot model.

## Failure Modes

- Plugins receive a broad runtime object and couple to unstable runtime
  internals.
- Plugins depend on preloaded full document bodies instead of explicit bindings
  and local file reads.
- Approval is split across separate `uses` and `await` step mechanics.
- Approval ingress targets a step id instead of the unresolved run id.
- Approval wait state is not durably reflected in the run snapshot and pending
  approval steps cannot complete predictably after process loss.
- Core runtime starts persisting plugin-private observers or exposes a generic
  file-watch API too early.

## Review Gate

- Plugins receive the curated stable `context` fields and no broad runtime
  object.
- `context.dispatchFlow({...})` remains available for runtime-native downstream
  flow handoff.
- `context.requestApproval()` prints standard approval instructions from Pravaha
  and keeps the plugin step unresolved until approval arrives.
- `pravaha approve --token <run_id>` routes approval to the matching unresolved
  run.
- After approval ingress, Pravaha continues from the durable wait boundary and
  the plugin-backed step completes without a separate workflow `await` step.
- No separate durable signal record is required for approval routing.
- No file-watch API or broad observer surface is added to plugin `context`.
- `npm run all` passes.
