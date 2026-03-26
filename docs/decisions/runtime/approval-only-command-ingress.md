---
Kind: decision
Id: approval-only-command-ingress
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Approval-Only Command Ingress

- Introduce one built-in pending interaction primitive in `v0.1`:
  `await context.requestApproval()`.
- Keep approval as one plugin-backed step lifecycle instead of splitting it
  across `uses` and a separate `await` step.
- Keep plugin waiting logic callback-style and plugin-owned.
- Re-enter `run(context)` on resume or restart so plugins can re-register their
  waiting behavior idempotently.
- Do not expose a general local observer API on plugin context in `v0.1`.
- Keep file watching and other local observation plugin-owned.
- Treat git hooks as one way to wake Pravaha or reach command ingress rather
  than as a distinct waiting API.
- Complete approval through one built-in CLI path:
  `pravaha approve --token <run_id>`.
- Keep the routing token run-scoped instead of step-scoped in `v0.1`.
- Print a standard approval instruction from Pravaha itself when approval is
  requested.
- Keep approval the only built-in pending interaction until broader use cases
  justify additional runtime primitives.

## Rationale

- One built-in approval path covers the immediate human-gate workflows without
  inventing a larger interaction framework too early.
- Callback-style waiting keeps each plugin responsible for its own handoff and
  completion behavior.
- Re-entering `run(context)` on resume keeps the runtime simpler than persisting
  plugin callback registrations.
- A standard approval instruction gives operators one predictable CLI shape
  while still letting plugins print any extra context they need.
