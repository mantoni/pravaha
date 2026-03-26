---
Kind: decision
Id: run-scoped-plugin-signal-emission
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Run-Scoped Plugin Signal Emission

- Treat plugin-backed interaction and observation as run-scoped in `v0.1`.
- Allow plugins to emit only signal kinds they declare in their own `emits`
  contract.
- Limit plugin-emitted signals to the current run and its bound workflow
  subjects.
- Expose signal production to plugins through
  `await context.emit(kind, payload)`.
- Provide a stable run-scoped identifier on plugin context for use as an
  idempotency key.
- Require plugins to manage their own idempotency and any private observer
  state.
- Do not persist plugin-private observer state in the core runtime.
- Allow Pravaha to expose convenience observer APIs for simple run-scoped local
  mechanisms such as file watches or git-hook integrations.
- Allow plugins to implement their own monitoring mechanisms when they need
  something more elaborate than the convenience observer APIs.
- Tear down the plugin step lifecycle after the first emitted signal for that
  run.

## Rationale

- Run-scoped signal emission keeps flow progression auditable and avoids
  cross-flow coupling through arbitrary plugin events.
- A stable idempotency key gives plugins a practical way to tolerate retries and
  restarts without forcing plugin-private state into the core runtime.
- Keeping plugin-private observer state out of the runtime preserves a clean
  plugin boundary and avoids premature observer persistence machinery.
- First-signal teardown gives the runtime one simple completion rule for
  interaction plugins without needing plugin-specific terminal-signal metadata.
