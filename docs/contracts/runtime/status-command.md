---
Kind: contract
Id: status-command
Status: active
Decided by:
  - docs/decisions/runtime/live-status-command-with-durable-fallback.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
Depends on:
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/contracts/runtime/runtime-node-lifecycle.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
---

# Status Command

## Intent

- Expose one operator-facing `pravaha status` command that lists the current
  flow instances Pravaha knows about, grouped by status.

## Inputs

- The current canonical runtime records under `.pravaha/runtime/`.
- The dispatcher-owned worker pool and local dispatch IPC endpoint when one
  dispatcher is live.
- The accepted current-truth runtime snapshot model and local dispatch runtime
  contracts.

## Outputs

- One `pravaha status [path]` command.
- One structured status result that groups flow instances under: `running`,
  `pending`, `waiting-approval`, `waiting-queue`, `succeeded`, and `failed`.
- One `connected_worker_count` field sourced from the live dispatcher when
  available and reported as `0` otherwise.
- One checkout directory field for each `running` flow instance.

## Side Effects

- `pravaha status` may probe the local dispatcher socket to gather live worker
  and in-flight assignment state.
- When the dispatcher is unavailable, `pravaha status` still reads local durable
  runtime records and returns the degraded snapshot.

## Invariants

- Durable runtime records remain the authoritative source for all non-live
  statuses.
- `running` is a best-effort live overlay and must not be required for the
  command to succeed.
- A flow instance appears in exactly one status group in the returned result.
- A flow instance with an unresolved approval wait appears in
  `waiting-approval`.
- A flow instance with `queue_wait.state == waiting` appears in `waiting-queue`.
- An unresolved flow instance without a live assignment or durable wait appears
  in `pending`.
- Terminal runtime outcomes appear in `succeeded` or `failed`.

## Failure Modes

- `pravaha status` fails when no dispatcher is running even though durable
  runtime records are present.
- `pravaha status` reports a stale `running` overlay after a dispatcher restart
  because it ignored durable fallback behavior.
- `pravaha status` hides unresolved runtime records that are resumable but not
  currently assigned.
- `pravaha status` omits the checkout directory for live assignments.

## Review Gate

- `pravaha help` exposes `pravaha status [path]`.
- `pravaha status` reports grouped flow-instance status with no dispatcher
  running.
- `pravaha status` overlays live `running` assignments and connected worker
  count when a dispatcher is reachable.
- `pravaha status` shows the checkout directory for `running` flow instances.
- `npm run all` passes.
