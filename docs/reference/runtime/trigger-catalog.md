---
Kind: reference
Id: trigger-catalog
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Trigger Catalog

This document captures the trigger surface for the trigger-driven runtime.

## Trigger Model

- Pravaha does not need to run as a mandatory daemon in `v0.1`.
- Reconciliation is activated by explicit triggers.
- Dispatch workers rescan authoritative runtime state on startup or takeover.
- `pravaha resume` remains the strict manual path for unresolved runtime records
  when operators need to re-enter one recorded attempt directly.

## Trigger Types

```json
{
  "triggers": [
    "CLI reconcile command",
    "git hooks",
    "file watchers",
    "webhooks or network requests",
    "optional periodic sweep"
  ]
}
```

## Roles

| Trigger        | Purpose                                 | Typical use                                                          |
| -------------- | --------------------------------------- | -------------------------------------------------------------------- |
| CLI worker     | Long-running local worker-pool runtime  | Startup or takeover rescan, live assignment supervision              |
| CLI dispatch   | Best-effort dispatcher wake-up          | Nudge the active dispatcher after durable state changes              |
| CLI reconcile  | Explicit operator-driven reconciliation | Debug a flow, run local progress checks, execute pre-dispatch slices |
| CLI resume     | Strict manual re-entry for one run      | Re-enter one unresolved recorded attempt directly                    |
| Git hooks      | React to local repository actions       | Reconcile after commit, branch movement, or review prep              |
| File watchers  | React to local file changes             | Notice document or config changes that affect readiness              |
| Webhooks       | React to external systems               | Review completion, merge queue state, remote integration signals     |
| Periodic sweep | Catch missed events                     | Poll remote state when no direct callback exists                     |

## Trigger To Runtime Relation

```mermaid
graph LR
  A["CLI worker"] --> G["Worker pool"]
  B["CLI dispatch"] --> G
  C["CLI reconcile"] --> F["Single-run reconcile"]
  D["CLI resume"] --> H["Strict resume"]
  E["Git hook / file watcher / webhook / sweep"] --> B
  G --> I["Evaluate authoritative runtime state"]
  F --> I
  H --> I
```
