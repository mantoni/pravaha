---
Kind: decision
Id: flattened-dispatcher-socket-path
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Flattened Dispatcher Socket Path

- Place the Unix dispatcher socket directly at `.pravaha/dispatcher.sock`.
- Stop creating or depending on the `.pravaha/dispatch/` directory.
- Treat the flattened socket path as a breaking change with no backward
  compatibility fallback.
- Keep the Windows named-pipe behavior unchanged.

## Rationale

- The dispatch directory currently exists only to host a single socket file.
- Flattening the endpoint removes one level of path indirection without changing
  the dispatcher ownership model.
- A direct cut keeps the runtime contract explicit and avoids carrying dead
  compatibility logic for an internal machine-local IPC path.
