---
Kind: decision
Id: automatic-follower-failover
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Automatic Follower Failover

- Keep connected follower workers alive when the active dispatcher exits or the
  leader connection drops unexpectedly.
- Treat follower leader loss as a re-entry point into local leader election
  instead of terminal worker shutdown.
- Let the first surviving worker that reacquires the dispatcher endpoint become
  the new dispatcher and rescan authoritative runtime state before claiming the
  system is idle.
- Let surviving workers that do not win the endpoint reconnect to the new
  dispatcher as followers.
- Preserve explicit operator stop and process abort as terminal worker shutdown
  signals.

## Rationale

- Restart-only takeover leaves the worker pool empty after leader loss even when
  healthy followers are already running on the same machine.
- Re-entering election from connected followers matches the local worker-pool
  intent better than forcing operators to manually restart surviving workers.
- The authoritative runtime store already carries the durable state needed for
  safe takeover rescans, so automatic failover can remain stateless at the IPC
  layer.
