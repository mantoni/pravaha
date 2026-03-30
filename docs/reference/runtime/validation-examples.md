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
  "plugins": {
    "dir": "plugins"
  },
  "flows": {
    "default_matches": ["docs/flows/**/*.yaml"]
  }
}
```

## Invalid Config Examples

Invalid because `flows.default_matches` must contain only non-empty strings:

```json
{
  "flows": {
    "default_matches": ["docs/flows/**/*.yaml", ""]
  }
}
```

Invalid because `plugins.dir` must be a non-empty string when present:

```json
{
  "plugins": {
    "dir": "  "
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
  patram:
    $class == task and tracked_in == contract:simple-task-flow and status ==
    ready

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
  patram:
    $class == task and tracked_in == contract:invalid-generic-update and status
    == ready

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

Invalid because `flow.on.patram` must constrain exactly one non-runtime Patram
class:

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
  patram: $class in [task, contract]

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
  patram:
    $class == task and tracked_in == contract:invalid-job-workspace and status
    == ready

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
  patram:
    $class == task and tracked_in == contract:invalid-workspace-mode and status
    == ready

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
  patram:
    $class == task and tracked_in == contract:invalid-workspace-source-mix and
    status == ready

jobs:
  implement:
    uses: core/run-codex
    next: done

  done:
    end: success
```
