---
Kind: decision
Id: remove-plugin-signal-emission
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Remove Plugin Signal Emission

- Remove plugin signal emission from the public `v0.1` plugin contract.
- Do not expose `context.emit(...)` on plugin `context`.
- Do not require or accept plugin `emits` declarations.
- Treat one completed plugin visit as producing one typed result value for
  `next` evaluation.
- Keep approvals and other persistent waits on explicit plugin context helpers
  such as `requestApproval()` rather than on emitted runtime signals.
- Do not retain a plugin-signal query surface in the durable run snapshot.
- Treat this as a breaking checked-in plugin API change with no compatibility
  shims.

## Rationale

- The current state-machine runtime evaluates `next` from `result` and prior
  `jobs.<name>.outputs`, not from a separate emitted-signal surface.
- Keeping both result values and plugin signals creates two competing output
  models for one job visit.
- Removing `emit` and `emits` simplifies plugin authoring, plugin validation,
  and step execution around one outcome shape.
- Approval remains explicit without needing a parallel signal mechanism.
