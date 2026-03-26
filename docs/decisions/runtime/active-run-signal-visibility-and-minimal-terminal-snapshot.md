---
Kind: decision
Id: active-run-signal-visibility-and-minimal-terminal-snapshot
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Active-Run Signal Visibility And Minimal Terminal Snapshot

- Keep plugin-emitted and other non-terminal runtime signals queryable for the
  whole active run while that run remains unresolved.
- Do not retain rich plugin-emitted interaction signals after the run resolves.
- After run resolution, retain only the minimal current terminal run snapshot
  needed for predictable local flow-instance and terminal-completion visibility.
- Require anything that must matter after run completion to be projected into
  durable checked-in workflow state before the run resolves.
- Keep retained terminal runtime state limited to the current matching run
  snapshot instead of becoming a richer local interaction-history layer.

## Rationale

- Active-run signal visibility keeps in-run `await` and `if` queries simple
  without forcing every intermediate result into checked-in workflow documents.
- Minimal retained terminal state preserves a clear boundary between current-run
  execution context and durable workflow truth.
- Requiring durable projection for post-run meaning prevents local runtime
  snapshots from quietly becoming a second history store.
