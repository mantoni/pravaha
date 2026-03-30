---
Kind: reference
Id: pravaha-flow-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Examples

This document captures illustrative state-machine flow examples for the checked-
in runtime surface.

## Example Repo Config

```json
{
  "workspaces": {
    "app": {
      "mode": "pooled",
      "paths": [".pravaha/worktrees/abbott", ".pravaha/worktrees/castello"],
      "ref": "main",
      "source": {
        "kind": "repo"
      }
    },
    "validation": {
      "mode": "ephemeral",
      "base_path": ".pravaha/worktrees/validation",
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
    "default_matches": ["docs/flows/runtime/*.yaml"]
  }
}
```

## Implement Then Review

```yaml
workspace:
  id: app

on:
  patram:
    $class == task and tracked_in == contract:task-reviewed-then-merge and
    status == ready

jobs:
  implement:
    uses: core/run-codex
    with:
      prompt: Implement the task in ${{ task.path }}.
      reasoning: medium
    next: review

  review:
    uses: core/approval
    with:
      title: Review ${{ task.path }}
      message: Approve or request another revision.
      options: [approve, revise]
    next:
      - if: ${{ result.verdict == "approve" }}
        goto: maybe_commit
      - goto: revise

  revise:
    uses: core/run-codex
    with:
      prompt: |
        Address the latest review feedback for ${{ task.path }}.

        ${{ jobs.review.outputs.comment }}
      reasoning: medium
    limits:
      max-visits: 2
    next: review

  maybe_commit:
    uses: core/git-status
    next:
      - if: ${{ result.dirty }}
        goto: commit
      - goto: done

  commit:
    uses: core/run-codex
    with:
      prompt: Commit the current changes for ${{ task.path }}.
      reasoning: medium
    next: done

  done:
    end: success
```

## Implement Then Handoff

```yaml
workspace:
  id: app

on:
  patram:
    $class == task and tracked_in == contract:integration-handoff and status ==
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
      capture: [stdout, stderr]
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: handoff
      - goto: fix

  fix:
    uses: core/run-codex
    with:
      prompt: |
        The tests failed for ${{ task.path }}.

        stdout:
        ${{ jobs.test.outputs.stdout }}

        stderr:
        ${{ jobs.test.outputs.stderr }}
      reasoning: medium
    limits:
      max-visits: 3
    next: test

  handoff:
    uses: core/flow-dispatch
    with:
      flow: integration
      wait: false
      inputs:
        task_path: ${{ task.path }}
        ref: ${{ git.head }}
    next: done

  done:
    end: success
```

## Land A Reviewed Branch

```yaml
workspace:
  id: app

on:
  patram:
    $class == task and tracked_in == contract:reviewed-branch-landed and status
    == ready

jobs:
  merge_branch:
    uses: core/git-merge
    with:
      head: review/ready/${{ task.id.replaceAll(':', '-') }}
      message: Merge reviewed work for ${{ task.path }}
    next: done

  done:
    end: success
```

## Publish Worktree Output

```yaml
workspace:
  id: app

on:
  patram:
    $class == task and tracked_in == contract:publish-worktree-output and status
    == ready

jobs:
  handoff:
    uses: core/worktree-handoff
    with:
      branch: review/ready/${{ task.id.replaceAll(':', '-') }}
    next: publish

  publish:
    uses: core/worktree-squash
    with:
      target: main
      message: Publish reviewed work for ${{ task.path }}
    next: done

  done:
    end: success
```

## Flow Shape Summary

```json
{
  "top_level_keys": ["workspace", "on", "jobs"],
  "job_keys": ["uses", "with", "limits", "next", "end"],
  "runtime_bindings": ["result", "jobs.<name>.outputs", "task", "git"],
  "invariants": [
    "The first declared job is the entrypoint.",
    "Each visit chooses exactly one next job or terminates with end.",
    "If no next branch matches, the flow fails implicitly.",
    "jobs.<name>.outputs resolves to the latest completed visit."
  ]
}
```
