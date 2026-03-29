---
Kind: task
Id: add-local-dispatch-protocol-and-leader-election
Status: done
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Depends on:
  - docs/tasks/local-dispatch-runtime/add-worker-and-dispatch-cli-surfaces.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
---

# Add Local Dispatch Protocol And Leader Election

- Add the portable local endpoint abstraction over Unix sockets and Windows
  named pipes.
- Implement leader election by endpoint ownership, follower registration, and
  best-effort notify delivery.
- Keep the protocol minimal and internal, with explicit assignment, completion,
  failure, and wake-up messages.
