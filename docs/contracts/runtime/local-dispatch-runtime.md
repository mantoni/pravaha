---
Kind: contract
Id: local-dispatch-runtime
Status: proposed
Decided by:
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
  - docs/decisions/runtime/automatic-follower-failover.md
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
- Flow validation and interpretation for one root-level durable trigger binding
  per dispatchable flow.
- Dispatcher scheduling that discovers pending flow instances from authoritative
  state and assigns them to available workers.
- Runtime persistence that makes worker takeover and rediscovery safe after
  notification loss, dispatcher failure, or worker failure.
- Connected followers that lose the dispatcher re-enter election and either
  become the new dispatcher or reconnect to the new leader.

## Side Effects

- Long-running worker processes own local terminal output until the operator
  stops them.
- A machine-local IPC endpoint exists while the dispatcher is alive.
- Dispatcher memory carries transient worker registration and in-flight
  assignment state between rescans.
- Existing sample and fixture flows that rely on `jobs.<name>.select` need
  migration to the new trigger surface before they can run on the dispatcher.

## Invariants

- At most one worker owns the dispatcher endpoint at a time.
- Each matched durable trigger document yields one scheduler-visible flow
  instance.
- Only the dispatcher chooses which flow instance to assign next.
- Notifications may be dropped without violating correctness.
- Dispatcher startup or takeover rescans authoritative state before claiming the
  system is idle.
- A worker may supervise at most one active assignment at a time in the first
  slice.
- Dispatcher loss does not require operators to restart surviving followers
  before takeover can happen.

## Failure Modes

- Dispatcher takeover fails to rediscover pending flow instances after a crash.
- Surviving followers exit instead of re-entering leader election after
  dispatcher loss.
- Two workers believe they own the same flow instance or worktree assignment.
- A lost notification leaves work stranded until a later manual dispatch or
  worker restart.
- Migrated flows still allow hidden fan-out inside jobs and become ambiguous to
  schedule centrally.
- Worker terminal output no longer identifies which assignment the operator is
  supervising.

## Review Gate

- Dispatchable flows validate with a root-level `on` trigger and fail clearly
  when they still rely on unsupported job-level fan-out.
- `pravaha worker` can start as dispatcher or follower and reports its role
  clearly.
- `pravaha dispatch` wakes the dispatcher without requiring the caller to know
  which worker is leader.
- Dispatcher takeover rescans and redispatches durable pending work after a
  crash.
- A connected follower can take over leadership after dispatcher shutdown
  without requiring a manual worker restart.
- The runtime keeps one active assignment per worker and avoids duplicate
  ownership of a durable flow instance.
- `npm run all` passes.
