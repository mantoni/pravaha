---
Kind: reference
Id: runtime-node-model
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Runtime Node Model

This document captures the working model for the mixed runtime graph under the
state-machine engine.

## Reserved Runtime Classes

```json
{
  "runtime_classes": [
    "$flow_instance",
    "$lease",
    "$worktree",
    "$worker",
    "$signal"
  ]
}
```

## Roles

| Class            | Role                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `$flow_instance` | Local runtime state for one durable job chain rooted at one durable item |
| `$lease`         | Local ownership record for a leaseable document                          |
| `$worktree`      | Local workspace materialization and reuse state                          |
| `$worker`        | One supervised local agent or command execution                          |
| `$signal`        | Runtime event emitted by plugins, approvals, or integrations             |

## Expected Shape

```json
{
  "$flow_instance": [
    "root_document",
    "flow_document",
    "current_job_name",
    "job_outputs",
    "visit_counts"
  ],
  "$lease": ["subject", "owner", "state"],
  "$worktree": ["name", "path", "state", "mode"],
  "$worker": ["subject", "worktree", "state", "backend"],
  "$signal": ["kind", "subject", "outcome", "emitted_at"]
}
```

## Query Model

- Root-level `on.<binding>.where` still selects the durable document that owns
  one flow instance.
- `next` expressions evaluate the current visit through `result`.
- Historical node data is exposed through `jobs.<name>.outputs`.
- Runtime nodes remain machine-local even though they can participate in the
  same query model as durable workflow documents.

## Example Branch

```yaml
next:
  - if: ${{ result.exit_code == 0 }}
    goto: done
  - goto: failed
```

This expression branches on the current job visit while the engine persists the
latest completed outputs for future jobs.
