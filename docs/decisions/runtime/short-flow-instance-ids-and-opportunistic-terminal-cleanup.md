---
Kind: decision
Id: short-flow-instance-ids-and-opportunistic-terminal-cleanup
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Short Flow Instance Ids And Opportunistic Terminal Cleanup

- Treat `flow_instance_id` as a short operator-facing durable identifier instead
  of as a deterministic projection of the scheduler identity.
- Allocate new flow-instance ids as three lower-case letters.
- Retry id allocation until a free retained id is found, and fail clearly if the
  retained runtime store exhausts the three-letter space.
- Persist `flow_instance_id` in the runtime record and treat that stored value
  as the canonical id for operator commands, status output, and live worker
  coordination.
- Keep rerun suppression keyed by the exact current scheduler identity:
  `flow_path` plus the matched owner document id.
- During explicit `pravaha dispatch --flow <flow_instance_id>` reruns, reuse the
  retained terminal record's stored `flow_instance_id` for the rerun instead of
  allocating a new id.
- Opportunistically delete terminal runtime records only when all of the
  following are true:
  - the record has been terminal for at least 72 hours
  - the record's exact scheduler identity no longer matches authoritative state
- Run that cleanup opportunistically during existing runtime entrypoints such as
  dispatcher rescans and status reads instead of adding a dedicated cleanup
  process.
- Make this change as a local runtime-state breaking change with no backward
  compatibility for existing hash-shaped `flow_instance_id` values on disk.

## Rationale

- Three-letter ids are easier to read, type, and remember during operator-driven
  dispatch and status workflows.
- Keeping a separate exact-match suppression key preserves today's safe default
  rerun behavior even when the visible flow-instance id is no longer
  deterministic.
- Opportunistic cleanup removes stale local runtime records without introducing
  a second always-on local service.
