---
Kind: task
Id: add-worker-and-dispatch-cli-surfaces
Status: done
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
---

# Add Worker And Dispatch CLI Surfaces

- Add `pravaha worker` as the long-running worker-pool entrypoint.
- Add `pravaha dispatch` as the best-effort wake-up command.
- Remove the legacy `pravaha reconcile` and `pravaha resume` command surfaces.
- Make worker terminal output identify worker id, leadership role, and assigned
  flow instance clearly enough for operator supervision.
