---
Kind: reference
Id: runtime-node-model
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Run Snapshot Model

This document captures the working model for durable local runtime state under
the JavaScript flow runtime.

## Canonical Durable Shape

```json
{
  "run_snapshot": [
    "task_id",
    "task_path",
    "flow_path",
    "run_id",
    "current_handler_name",
    "local_outcome",
    "durable_state",
    "wait_state"
  ]
}
```

## Role

The canonical run snapshot is the durable machine-local record for one live task
run. It preserves only the execution memory required to continue safely from the
latest checkpoint. Active worker, lease, and worktree ownership remain transient
operational state and are not part of the durable contract.

## Expected Shape

```json
{
  "run_snapshot": [
    "task_id",
    "task_path",
    "flow_module",
    "current_handler_name",
    "durable_state",
    "local_outcome",
    "wait_state"
  ]
}
```

## Query Model

- Root-level `defineFlow({ on: ... })` metadata still selects the durable
  document that owns one run snapshot.
- Replay resumes by restarting the recorded named handler from the top.
- Durable user state is exposed through `ctx.state` and persists only after
  `await ctx.setState(...)`.
- Wait state records the named re-entry handler plus optional payload data.
- Separate durable runtime-node classes are no longer required for waits or
  other flow-visible runtime state.

## Example Wait

```json
{
  "wait_state": {
    "kind": "approval",
    "handler_name": "onApprove",
    "data": {
      "approved_prompt": "Ship the validated change."
    }
  }
}
```

This snapshot records the named re-entry target and the payload passed back into
the flow when approval arrives.
