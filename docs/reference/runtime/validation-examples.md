---
Kind: reference
Id: validation-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Validation Examples

This document captures example validation cases for `pravaha.json` and state-
machine flow documents.

## Valid Config Example

```json
{
  "semantic_roles": {
    "contract": ["contract"],
    "decision": ["decision"],
    "flow": ["flow"],
    "task": ["task"]
  },
  "semantic_states": {
    "active": ["active"],
    "blocked": ["blocked"],
    "proposed": ["proposed"],
    "ready": ["ready"],
    "review": ["review"],
    "terminal": ["accepted", "done", "dropped", "superseded"]
  },
  "plugins": {
    "dir": "plugins"
  },
  "flows": {
    "default_matches": ["docs/flows/**/*.yaml"],
    "root_flow_label": "Implementation flow"
  }
}
```

## Invalid Config Examples

Invalid because a required semantic role is missing:

```json
{
  "semantic_roles": {
    "contract": ["contract"]
  },
  "semantic_states": {
    "ready": ["ready"]
  }
}
```

Invalid because a required semantic state is missing:

```json
{
  "semantic_roles": {
    "contract": ["contract"],
    "decision": ["decision"],
    "flow": ["flow"],
    "task": ["task"]
  },
  "semantic_states": {
    "active": ["active"]
  }
}
```

Invalid because `flows.root_flow_label` is empty:

```json
{
  "semantic_roles": {
    "contract": ["contract"],
    "decision": ["decision"],
    "flow": ["flow"],
    "task": ["task"]
  },
  "semantic_states": {
    "active": ["active"],
    "blocked": ["blocked"],
    "proposed": ["proposed"],
    "ready": ["ready"],
    "review": ["review"],
    "terminal": ["accepted", "done", "dropped", "superseded"]
  },
  "flows": {
    "root_flow_label": ""
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

Invalid because repo-backed pooled workspaces must declare exactly one of
`source.id` or `source.ids`:

```yaml
kind: flow
id: invalid-workspace-source-mix
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
    ids:
      - app
      - app-1
  materialize:
    kind: worktree
    mode: pooled
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
