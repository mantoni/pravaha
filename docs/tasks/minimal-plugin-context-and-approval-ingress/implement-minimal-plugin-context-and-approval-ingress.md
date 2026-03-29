---
Kind: task
Id: implement-minimal-plugin-context-and-approval-ingress
Status: done
Tracked in: docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
Implements: docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
Decided by:
  - docs/decisions/runtime/minimal-curated-plugin-context.md
  - docs/decisions/runtime/approval-only-command-ingress.md
  - docs/decisions/runtime/run-scoped-plugin-signal-emission.md
---

# Implement Minimal Plugin Context And Approval Ingress

- Expose only the stable curated `v0.1` plugin `context` fields.
- Add `await context.requestApproval()` as the only built-in pending interaction
  primitive.
- Print standard Pravaha approval output that uses the current `run_id` as the
  operator token.
- Add `pravaha approve --token <run_id>` and route approval to the matching
  unresolved run.
- Re-enter `run(context)` on resume so pending plugin-backed approval steps may
  complete idempotently without a separate workflow `await` step.
- Keep file watching and any other local observation plugin-owned.
