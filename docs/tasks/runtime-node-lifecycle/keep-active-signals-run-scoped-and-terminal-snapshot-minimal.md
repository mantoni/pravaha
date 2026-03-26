---
Kind: task
Id: keep-active-signals-run-scoped-and-terminal-snapshot-minimal
Status: ready
Tracked in: docs/contracts/runtime/runtime-node-lifecycle.md
Implements: docs/contracts/runtime/runtime-node-lifecycle.md
Decided by:
  - docs/decisions/runtime/active-run-signal-visibility-and-minimal-terminal-snapshot.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
---

# Keep Active Signals Run-Scoped And Terminal Snapshot Minimal

- Keep active non-terminal runtime signals queryable for the whole unresolved
  run.
- Retain only the minimal current terminal run snapshot after resolution.
- Drop richer plugin-emitted interaction signals from the retained terminal
  snapshot.
- Preserve fail-closed behavior when multiple retained matches would make the
  current run ambiguous.
- Require anything that matters after completion to be projected into durable
  checked-in workflow state instead of relying on retained local signals.
