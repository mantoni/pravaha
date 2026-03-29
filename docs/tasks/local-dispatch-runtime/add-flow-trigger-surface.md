---
Kind: task
Id: add-flow-trigger-surface
Status: done
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
---

# Add Flow Trigger Surface

- Extend flow schema and validation to accept one root-level
  `on.<binding>.where` trigger for dispatchable flows.
- Bind the trigger document into interpreted flow instances and update runtime
  fixtures to exercise the new binding shape.
- Reject migrated dispatch flows that still rely on unsupported job-level
  durable fan-out.
