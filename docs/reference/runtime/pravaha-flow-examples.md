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

## Implement Then Review

```yaml
kind: flow
id: task-reviewed-then-merge
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
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
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
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: |
        Address the latest review feedback for ${{ task.path }}.

        ${{ jobs.review.outputs.comment }}
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
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Commit the current changes for ${{ task.path }}.
    next: done

  done:
    end: success
```

## Implement Then Handoff

```yaml
kind: flow
id: integration-handoff
status: active
scope: contract

workspace:
  type: git.workspace
  source:
    kind: repo
    id: app
  materialize:
    kind: worktree
    mode: pooled
    ref: main

on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  implement:
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
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
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: |
        The tests failed for ${{ task.path }}.

        stdout:
        ${{ jobs.test.outputs.stdout }}

        stderr:
        ${{ jobs.test.outputs.stderr }}
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

## Flow Shape Summary

```json
{
  "top_level_keys": [
    "kind",
    "id",
    "status",
    "scope",
    "workspace",
    "on",
    "jobs"
  ],
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
