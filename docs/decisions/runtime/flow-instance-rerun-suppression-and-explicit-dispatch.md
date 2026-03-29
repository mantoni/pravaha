---
Kind: decision
Id: flow-instance-rerun-suppression-and-explicit-dispatch
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Flow Instance Rerun Suppression And Explicit Dispatch

- Treat a terminal runtime record for a still-matching flow instance as evidence
  that the dispatcher has already run that instance.
- During authoritative rescans, warn and ignore matching flow instances that
  already have a terminal runtime record instead of scheduling them again.
- Add `pravaha dispatch --flow <flow_instance_id> [path]` as an explicit
  operator override that schedules exactly that flow instance even when a
  terminal runtime record already exists.
- Keep the default `pravaha dispatch [path]` wake-up behavior best-effort and
  non-destructive. It may surface warnings for already-run matching instances
  but must not rerun them implicitly.
- After a worker completes a flow instance, re-evaluate whether that same flow
  instance still matches the current authoritative graph and warn when it still
  does.

## Rationale

- Restart recovery should preserve idempotence for completed work instead of
  turning terminal runtime records into accidental requeue triggers.
- An explicit `--flow` override gives operators a narrow rerun escape hatch
  without weakening the safety of the default dispatch path.
- Rechecking the match after completion surfaces cases where the run resolved
  without projecting durable workflow state strongly enough to break the
  original match.
