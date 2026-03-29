---
Kind: task
Id: suppress-reruns-of-completed-flow-instances
Status: done
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Depends on:
  - docs/tasks/local-dispatch-runtime/dispatch-triggered-flow-instances.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/flow-instance-rerun-suppression-and-explicit-dispatch.md
---

# Suppress Reruns Of Completed Flow Instances

- Warn and ignore still-matching flow instances when a terminal runtime record
  shows that the dispatcher already ran them.
- Add `pravaha dispatch --flow <flow_instance_id>` as the explicit rerun
  override.
- Warn after worker completion when the completed flow instance still matches
  the authoritative graph.
