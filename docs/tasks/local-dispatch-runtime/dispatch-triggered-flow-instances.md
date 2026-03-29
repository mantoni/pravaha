---
Kind: task
Id: dispatch-triggered-flow-instances
Status: done
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Depends on:
  - docs/tasks/local-dispatch-runtime/add-flow-trigger-surface.md
  - docs/tasks/local-dispatch-runtime/add-local-dispatch-protocol-and-leader-election.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
---

# Dispatch Triggered Flow Instances

- Discover pending flow instances from authoritative state instead of from the
  old local reconcile loop.
- Assign one bound flow instance to one ready worker at a time.
- Keep the dispatcher responsible for worktree assignment and duplicate
  ownership prevention.
