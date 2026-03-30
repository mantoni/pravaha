---
Kind: contract
Id: local-dispatch-runtime
Status: proposed
Decided by:
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
  - docs/decisions/runtime/flattened-dispatcher-socket-path.md
  - docs/decisions/runtime/automatic-follower-failover.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
  - docs/decisions/runtime/flow-instance-rerun-suppression-and-explicit-dispatch.md
  - docs/decisions/runtime/short-flow-instance-ids-and-opportunistic-terminal-cleanup.md
  - docs/decisions/runtime/unresolved-run-worktree-exclusivity.md
Depends on:
  - docs/contracts/runtime/ordered-worktree-step-execution.md
  - docs/contracts/runtime/runtime-node-lifecycle.md
  - docs/contracts/runtime/single-flight-scheduler-depth.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/trigger-catalog.md
---

# Local Dispatch Runtime

## Intent

- Replace the single-run reconciler entrypoint with an operator-supervised local
  worker pool where one elected dispatcher schedules durable flow instances onto
  connected workers.

## Inputs

- The accepted dispatcher-owned worker pool decision.
- The accepted flow trigger entrypoint and instance binding decision.
- The current machine-local runtime store, worktree assignment rules, and
  locally supervised Codex worker behavior.
- Contract-scoped root flows that can be migrated from job-level `select` to a
  root-level `on` binding.

## Outputs

- One `pravaha worker` command that joins the local worker pool and can become
  dispatcher.
- One `pravaha dispatch` command that sends a best-effort wake-up notification.
- One `pravaha dispatch --flow <flow_instance_id>` override that reruns exactly
  one flow instance when the operator asks explicitly.
- Removal of the legacy single-run `pravaha reconcile` and `pravaha resume`
  command surfaces.
- Flow validation and interpretation for one root-level durable trigger binding
  per dispatchable flow.
- Dispatcher scheduling that discovers pending flow instances from authoritative
  state and assigns them to available workers.
- Runtime persistence that keeps one current-truth run snapshot per live task so
  completed job checkpoints and persistent waits survive notification loss and
  dispatcher failure.
- Connected followers that lose the dispatcher re-enter election and either
  become the new dispatcher or reconnect to the new leader.

## Side Effects

- Long-running worker processes own local terminal output until the operator
  stops them.
- A machine-local IPC endpoint exists at `.pravaha/dispatcher.sock` while the
  dispatcher is alive on Unix platforms.
- Dispatcher memory carries transient worker registration and in-flight
  assignment state between rescans.

## Invariants

- At most one worker owns the dispatcher endpoint at a time.
- Each matched durable trigger document yields one scheduler-visible flow
  instance.
- Only the dispatcher chooses which flow instance to assign next.
- Notifications may be dropped without violating correctness.
- Dispatcher startup or takeover rescans authoritative state before claiming the
  system is idle.
- The dispatcher never creates more than one live run snapshot for the same
  task.
- An unresolved run that owns a reusable worktree keeps that worktree occupied
  until the run reaches a terminal outcome or performs an explicit handoff.
- Default dispatcher rescans do not rerun a still-matching flow instance that
  already has a terminal runtime record.
- A worker may supervise at most one active assignment at a time in the first
  slice.
- Dispatcher loss does not require operators to restart surviving followers
  before takeover can happen.

## Failure Modes

- Dispatcher takeover fails to rediscover pending flow instances, durable waits,
  or completed job checkpoints after a crash.
- Dispatcher restart silently reruns a completed matching flow instance because
  it ignored the terminal runtime record.
- Surviving followers exit instead of re-entering leader election after
  dispatcher loss.
- Two workers create competing live run snapshots for the same task.
- Dispatcher scheduling reuses a reusable worktree that still belongs to an
  unresolved approval or queue wait and destroys resumable state.
- A lost notification leaves work stranded until a later manual dispatch or
  worker restart.
- Migrated flows still allow hidden fan-out inside jobs and become ambiguous to
  schedule centrally.
- Worker terminal output no longer identifies which assignment the operator is
  supervising.

## Review Gate

- Dispatchable flows validate with a root-level `on` trigger.
- `pravaha worker` can start as dispatcher or follower and reports its role
  clearly.
- `pravaha dispatch` wakes the dispatcher without requiring the caller to know
  which worker is leader.
- `pravaha dispatch --flow <flow_instance_id>` reruns only the named flow
  instance and bypasses the completed-instance suppression guard intentionally.
- Pravaha help and public docs expose `worker`, `dispatch`, and `approve`
  without the removed `reconcile` or `resume` commands.
- Dispatcher takeover rescans and preserves durable pending work after a crash.
- Default dispatch warns and ignores still-matching flow instances that already
  have a terminal runtime record.
- A worker warns when a flow instance still matches after its terminal outcome.
- A connected follower can take over leadership after dispatcher shutdown
  without requiring a manual worker restart.
- The runtime keeps one live run snapshot per task and avoids duplicate durable
  ownership of the same flow instance.
- Terminal runtime records older than the cleanup grace period are removed only
  after the exact matching scheduler identity disappears from authoritative
  state.
- Dispatcher scheduling reconstructs reusable worktree occupancy from unresolved
  run snapshots and does not assign conflicting work onto an occupied worktree.
- `npm run all` passes.
