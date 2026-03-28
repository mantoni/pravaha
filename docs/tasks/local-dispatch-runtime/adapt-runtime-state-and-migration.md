---
Kind: task
Id: adapt-runtime-state-and-migration
Status: ready
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Depends on:
  - docs/tasks/local-dispatch-runtime/dispatch-triggered-flow-instances.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
---

# Adapt Runtime State And Migration

- Rework runtime records and mixed-graph exposure for the dispatcher-backed
  worker pool.
- Remove the legacy manual reconcile and resume entrypoints from the migrated
  runtime surface.
- Add takeover, worker-loss, and duplicate-notify coverage for the new runtime
  model.
- Keep surviving followers in the worker pool across dispatcher loss by
  re-entering election and reconnecting automatically.
