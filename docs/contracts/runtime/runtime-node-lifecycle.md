---
Kind: contract
Id: runtime-node-lifecycle
Status: proposed
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
Depends on:
  - docs/contracts/runtime/job-level-worktree-policy.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/runtime-node-model.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/end-to-end-walkthrough.md
---

# Run Snapshot Lifecycle

## Intent

- Stabilize the lifecycle semantics of the canonical machine-local run snapshot
  so flows can query current durable progress predictably without depending on
  separate runtime-node history.

## Inputs

- The completed flow-surface slice that allows conditions over the current run
  snapshot.
- The completed job-level worktree policy slice.
- The current machine-local runtime store for checkpointed run snapshots and
  persistent waits.
- The accepted run-snapshot model and runtime architecture references.

## Outputs

- Stable lifecycle rules for one canonical durable run snapshot per live task.
- Runtime support that checkpoints current durable execution truth after every
  completed job visit and at every persistent wait or terminal outcome.
- Runtime support that embeds wait state inside the run snapshot instead of
  relying on separate signal records.
- Validation and execution semantics that prevent flows from depending on
  transient worker ownership or stale local history.
- No dedicated operator-facing inspection or cleanup surface in this slice.

## Side Effects

- Flow-visible local execution state becomes one snapshot-oriented query surface
  instead of a family of runtime-node records.
- Active worker, lease, and worktree ownership remain transient operational
  state instead of part of the durable contract.
- Interrupted in-flight job visits may be lost even though the latest durable
  checkpoint remains available.

## Invariants

- At most one durable run snapshot exists for a task at a time.
- The durable run snapshot records only the current truth needed for correct
  continuation and not a richer history.
- Prior job outputs and job visit counts remain durable because later branching
  and visit limits depend on them.
- Persistent waits live inside the run snapshot rather than in separate signal
  records.
- Flows may observe the current run snapshot but must not depend on unrelated
  old local runtime state.
- Anything that must matter after run completion must already be projected into
  durable checked-in workflow state.
- Re-entry after interruption starts from the latest durable checkpoint instead
  of from in-flight worker-session state.

## Failure Modes

- The durable snapshot omits prior outputs or visit counts and later branching
  becomes incorrect.
- Wait state is split across the run snapshot and a second signal store.
- Active worker ownership is mistaken for durable truth and blocks later
  re-entry after interruption.
- Multiple live snapshots exist for the same task and flow execution becomes
  ambiguous.
- The run-snapshot model diverges between execution semantics and the query
  contract exposed to flows.

## Review Gate

- Flows can observe the current durable run snapshot without depending on a
  richer runtime-node graph.
- Prior job outputs and visit counts remain available at the latest durable
  checkpoint.
- Persistent waits are represented inside the run snapshot.
- Anything that must matter after run completion is projected into durable
  workflow state before completion.
- Re-entry after interruption restarts from the latest durable checkpoint rather
  than from mid-visit worker state.
- Worktree policy remains compatible with the narrower durable snapshot model.
- `npm run all` passes.
