---
Kind: decision
Id: live-status-command-with-durable-fallback
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Live Status Command With Durable Fallback

- Add one operator-facing `pravaha status [path]` command for flow-instance
  visibility.
- Treat the canonical runtime records in `.pravaha/runtime/` as the durable
  source of truth for all persisted flow instances.
- Overlay a best-effort live `running` signal from the current dispatcher when a
  dispatcher is reachable.
- Degrade gracefully when no dispatcher is running by returning the durable
  status snapshot with zero connected workers and no live `running` overlay.
- Report connected worker count from the current dispatcher view when available.
- Show the checkout directory for `running` flow instances.

## Rationale

- Durable fallback keeps `pravaha status` useful during dispatcher restarts,
  crashes, and operator inspection outside the worker lifecycle.
- A best-effort live overlay exposes the one transient fact operators care about
  most: which flow instances are executing right now and where.
- Keeping terminal and waiting states durable preserves the current-truth run
  snapshot boundary instead of inventing a second operator state store.
