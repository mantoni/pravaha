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
  "workspaces": {
    "app": {
      "mode": "pooled",
      "paths": [".pravaha/worktrees/app"],
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    }
  },
  "plugins": {
    "dir": "plugins"
  },
  "flows": {
    "default_matches": ["docs/flows/**/*.js"]
  }
}
```

## Invalid Config Examples

Invalid because `flows.default_matches` must contain only non-empty strings:

```json
{
  "flows": {
    "default_matches": ["docs/flows/**/*.js", ""]
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

Invalid because every workspace must declare `mode` explicitly:

```json
{
  "workspaces": {
    "app": {
      "paths": [".pravaha/worktrees/app"],
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    }
  }
}
```

Invalid because ephemeral workspaces use `base_path`, not fixed `paths`:

```json
{
  "workspaces": {
    "validation": {
      "mode": "ephemeral",
      "paths": [".pravaha/worktrees/validation"],
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    }
  }
}
```

## Valid Flow Example

```yaml
workspace:
  id: app

on:
  patram:
    $class == task and tracked_in == contract:simple-task-flow and status ==
    ready

jobs:
  implement:
    uses: core/run-codex
    with:
      prompt: Implement the task in ${{ doc.path }}.
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
workspace:
  id: app

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
workspace:
  id: app
  materialize:
    mode: ephemeral

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
workspace:
  id: app

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

Invalid because flow workspace declarations now accept only `id`:

```yaml
workspace:
  id: app
  type: git.workspace

on:
  patram:
    $class == task and tracked_in == contract:invalid-workspace-shape and status
    == ready

jobs:
  implement:
    uses: core/run-codex
    next: done

  done:
    end: success
```

Invalid because flow-authored workspace location ids moved to top-level
`workspace.id` plus global `pravaha.json` config:

```yaml
workspace:
  id: app
  source:
    ids:
      - app

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
