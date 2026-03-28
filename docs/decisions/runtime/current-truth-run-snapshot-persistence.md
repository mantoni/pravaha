---
Kind: decision
Id: current-truth-run-snapshot-persistence
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Current-Truth Run Snapshot Persistence

- Persist one canonical mutable run snapshot per live task in the machine-local
  runtime store.
- Treat the durable runtime store as current truth only. Do not add event-log or
  transition-history requirements in `v0.1`.
- Allow at most one live run snapshot per task. The dispatcher must serialize
  matching flow execution for the same task.
- Checkpoint the canonical run snapshot after every completed job visit and at
  every persistent wait or terminal outcome.
- Keep in the durable snapshot only the state required to continue correctly:
  flow and task identity, current durable job position, run status, prior job
  outputs, per-job visit counts, and embedded wait state when a human gate is
  pending.
- Keep active worker, lease, heartbeat, and worktree ownership transient. These
  operational details must not be required to reconstruct the durable run
  snapshot.
- Evaluate flow branch conditions and persistent wait routing against durable
  workflow documents and the current run snapshot rather than against separate
  persisted runtime-node records such as `$signal`, `$worker`, or `$lease`.
- Route approval and other persistent wait ingress by updating the matching run
  snapshot instead of by resolving a separate signal record.
- Do not recover mid-visit worker execution or worker-session state after an
  interruption. Re-entry starts from the latest durable checkpoint rather than
  from in-flight process state.

## Rationale

- One canonical run snapshot keeps the runtime store legible while preserving
  the execution memory that later branching actually needs.
- Checkpointing after each completed job visit preserves prior outputs and visit
  counts without committing to exact worker-session recovery.
- Folding waits into the run snapshot removes a second persistence model for
  approvals and other human gates.
- Keeping active ownership transient avoids turning the local store into a
  pseudo-cluster coordination database when the product only needs one durable
  current-truth record per task.
