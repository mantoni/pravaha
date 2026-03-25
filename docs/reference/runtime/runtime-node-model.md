---
Kind: reference
Id: runtime-node-model
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Runtime Node Model

This document captures the working model for the mixed runtime graph.

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

| Class            | Role                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `$flow_instance` | Local runtime state for one flow execution rooted at one durable work item |
| `$lease`         | Local ownership record for a leaseable document                            |
| `$worktree`      | Local execution slot and its lifecycle state                               |
| `$worker`        | One supervised local Codex run                                             |
| `$signal`        | Runtime event emitted by steps, workers, reviews, or integrations          |

## Expected Shape

```json
{
  "$flow_instance": ["root_document", "flow_document", "state"],
  "$lease": ["subject", "owner", "state"],
  "$worktree": ["name", "path", "state"],
  "$worker": ["subject", "worktree", "state", "backend"],
  "$signal": ["kind", "subject", "outcome", "emitted_at"]
}
```

## Query Model

- Flow `if` and `await` expressions may query runtime nodes and durable workflow
  documents together.
- Runtime nodes are machine-local and transient even though they participate in
  the same query model.
- `jobs.<name>.select` still fans out only over durable workflow documents.

## Example Query

```yaml
await: $class == $signal and kind == worker_completed and subject == task
```

This expression uses a runtime node to observe progress for one durable work
item.
