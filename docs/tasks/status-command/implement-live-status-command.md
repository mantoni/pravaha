---
Kind: task
Id: implement-live-status-command
Status: done
Tracked in: docs/contracts/runtime/status-command.md
Implements: docs/contracts/runtime/status-command.md
---

# Implement Live Status Command

- Add the `pravaha status [path]` CLI surface.
- Group persisted runtime records into the operator-facing status taxonomy from
  the contract.
- Overlay best-effort live dispatcher assignment state onto durable runtime
  records.
- Report connected worker count and checkout directory for live running flow
  instances.
- Cover the command with protocol, runtime, and CLI tests.
