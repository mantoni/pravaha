---
Kind: reference
Id: validation-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Validation Examples

This document captures example validation cases for `.pravaha.json` and state-
machine flow documents.

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

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: ephemeral
    ref: main

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/run-codex
    with:
      prompt: Implement the task in ${{ task.path }}.
      reasoning: medium
    next: test

  test:
    uses: core/run
    with:
      command: npm test
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```

## Invalid Flow Examples

Invalid because root trigger selection is required for every flow:

```yaml
kind: flow
id: invalid-missing-trigger
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: ephemeral
    ref: main

jobs:
  implement:
    uses: core/run-codex
    next: done

  done:
    end: success
```

Invalid because plugin-shaped mutation fields such as `update` are not part of
the flow engine surface:

```yaml
kind: flow
id: invalid-generic-update
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: ephemeral
    ref: main

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/approval
    update:
      target: task
      set:
        status: review
    next: done

  done:
    end: success
```

Invalid because `on.<binding>.where` does not resolve to one durable class:

```yaml
kind: flow
id: invalid-ambiguous-trigger
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: ephemeral
    ref: main

on:
  item:
    where: $class in [task, contract]

jobs:
  implement:
    uses: core/run-codex
    next: done

  done:
    end: success
```

Invalid because worktree policy moved to the flow-level `workspace` block:

```yaml
kind: flow
id: invalid-job-workspace
status: active
scope: contract

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    worktree:
      mode: named
      slot: castello
    uses: core/run-codex
    next: done

  done:
    end: success
```

Invalid because repo-backed workspaces currently accept only `ephemeral` and
`pooled` worktree modes:

```yaml
kind: flow
id: invalid-workspace-mode
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: shared
    ref: main

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/run-codex
    next: done

  done:
    end: success
```
