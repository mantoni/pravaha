---
Kind: task
Id: implement-run-scoped-step-progress-and-plugin-signals
Status: done
Tracked in: docs/contracts/runtime/run-scoped-step-progress-and-plugin-signals.md
Implements: docs/contracts/runtime/run-scoped-step-progress-and-plugin-signals.md
Decided by:
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
  - docs/decisions/runtime/run-scoped-plugin-signal-emission.md
  - docs/decisions/runtime/generic-step-progress-persistence.md
---

# Implement Run-Scoped Step Progress And Plugin Signals

- Persist the current ordered-step position for all step kinds in the runtime
  record.
- Resume unresolved runs from the first incomplete step without re-running
  already completed earlier steps for the same run.
- Add plugin `context.emit(kind, payload)` runtime enforcement against declared
  `emits` schemas.
- Complete plugin steps on the first successful emitted signal.
- Keep emitted signals limited to the current run and its bound workflow
  subjects.
- Expose one stable run-scoped plugin idempotency identifier without persisting
  plugin-private observer state.
