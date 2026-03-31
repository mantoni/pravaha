---
Kind: decision
Id: run-scoped-plugin-signal-emission
Status: superseded
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Run-Scoped Plugin Signal Emission

- Pravaha no longer exposes plugin signal emission in `v0.1`.
- Plugins do not declare `emits` schemas.
- Plugins do not receive `context.emit(...)`.
- Typed plugin result values remain the one flow-visible output surface for a
  completed job visit.
- Persistent waits stay on explicit plugin helpers such as
  `context.requestApproval()`.

## Rationale

- The checked-in flow runtime already exposes one durable result surface to flow
  code and does not need a second emitted-signal model.
- Removing plugin signal emission avoids two competing output models for one job
  visit.
- Approval remains explicit without retaining a second signal-oriented runtime
  contract.
