---
Kind: reference
Id: validation-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Validation Examples

This document captures example validation cases for `.pravaha.json` and flow
documents.

## Valid Config Example

```json
{
  "roles": {
    "flow_document_class": "flow",
    "root_work_item_class": "contract",
    "leaseable_unit_class": "task",
    "dependency_relation": "depends_on",
    "root_flow_relation": "root_flow",
    "status_field": "status"
  },
  "states": {
    "ready": ["ready"],
    "active": ["active"],
    "review": ["review"],
    "blocked": ["blocked"],
    "done": ["done"],
    "dropped": ["dropped"]
  }
}
```

## Invalid Config Examples

Invalid because a required semantic role is missing:

```json
{
  "roles": {
    "flow_document_class": "flow",
    "root_work_item_class": "contract"
  },
  "states": {
    "ready": ["ready"]
  }
}
```

Invalid because a required semantic state is missing:

```json
{
  "roles": {
    "flow_document_class": "flow",
    "root_work_item_class": "contract",
    "leaseable_unit_class": "task",
    "dependency_relation": "depends_on",
    "root_flow_relation": "root_flow",
    "status_field": "status"
  },
  "states": {
    "ready": ["ready"],
    "active": ["active"]
  }
}
```

## Valid Flow Example

```yaml
kind: flow
id: simple-task-flow
status: active
scope: contract

jobs:
  implement_ready_tasks:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: ephemeral
    steps:
      - uses: core/codex-exec
      - await:
          $class == $signal and kind == worker_completed and subject == task
```

## Invalid Flow Examples

Invalid because `select` appears on a step instead of a job:

```yaml
kind: flow
id: invalid-step-select
status: active
scope: contract

jobs:
  implement:
    worktree:
      mode: ephemeral
    steps:
      - select: $class == task and status == ready
        uses: core/codex-exec
```

Invalid because the step uses a checked-in mutation shape outside the approved
semantic set:

```yaml
kind: flow
id: invalid-generic-update
status: active
scope: contract

jobs:
  implement:
    worktree:
      mode: ephemeral
    steps:
      - uses: core/request-review
        update:
          target: task
          set:
            status: review
```

Invalid because `jobs.<name>.select` does not resolve to one durable class:

```yaml
kind: flow
id: invalid-ambiguous-select
status: active
scope: contract

jobs:
  mixed:
    select: $class in [task, contract]
    worktree:
      mode: ephemeral
    steps:
      - uses: core/codex-exec
```

Invalid because worktree is declared on a step instead of a job:

```yaml
kind: flow
id: invalid-step-worktree
status: active
scope: contract

jobs:
  implement:
    worktree:
      mode: ephemeral
    steps:
      - uses: core/codex-exec
        worktree:
          mode: named
          slot: castello
```

Invalid because `named` worktree mode is missing the exact slot:

```yaml
kind: flow
id: invalid-named-worktree
status: active
scope: contract

jobs:
  implement:
    worktree:
      mode: named
    steps:
      - uses: core/codex-exec
```
