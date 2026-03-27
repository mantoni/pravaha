---
Kind: decision
Id: dispatcher-owned-local-worker-pool
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Dispatcher-Owned Local Worker Pool

- Add `pravaha worker` as the operator-launched long-running runtime process.
- Let operators launch as many workers as they want and keep each worker's
  output attached to the terminal that launched it.
- Use a local-only IPC endpoint so one worker becomes the dispatcher by owning
  the endpoint and the remaining workers register as followers.
- Add `pravaha dispatch` as a best-effort wake-up command that notifies the
  current dispatcher that new durable work may be available.
- Keep notifications lossy. The IPC transport is a wake-up bus, not a durable
  queue.
- Make the dispatcher responsible for authoritative pending-work discovery,
  worker availability tracking, worktree assignment, and concrete assignment of
  flow instances to connected workers.
- Keep correctness rooted in checked-in workflow documents and the machine-local
  runtime store. Dispatcher takeover or restart must recover by rescanning that
  state.
- Keep the coordinator inside the worker pool. Pravaha still does not require a
  separate daemon outside operator-launched workers.
- Supersede the single-flight trigger-driven reconcile model for flows migrated
  to the dispatch slice.

## Rationale

- The current reconcile loop is intentionally single-run and not concurrency
  safe enough to have many workers race through the same scheduling logic.
- A central dispatcher lets Pravaha reason once about eligible flow instances
  and assign them deliberately to available workers.
- A lossy wake-up channel preserves the desired local-only portability without
  forcing the transport to become the source of truth.
- Operator-supervised long-running workers fit the real usage model where work
  is long-lived and humans want to watch each worker directly.
