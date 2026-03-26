---
Kind: reference
Id: pravaha-flow-examples
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Examples

This document captures illustrative Pravaha config and flow examples discussed
while shaping the runtime model.

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

## Task Review Then Merge

```yaml
kind: flow
id: task-reviewed-then-merge
status: active
scope: contract

jobs:
  implement_ready_tasks:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: ephemeral
    steps:
      - name: Setup worktree
        uses: core/setup-worktree

      - name: Install dependencies
        run: npm ci

      - name: Implement task
        uses: core/codex-exec

      - name: Wait for worker completion
        await:
          $class == $signal and kind == worker_completed and subject == task

      - name: Request human review
        if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == success
        uses: core/request-review
        with:
          reviewer: human
        transition:
          target: task
          status: review

      - name: Wait for review completion
        await:
          $class == $signal and kind == review_completed and subject == task

      - name: Enqueue merge
        if:
          $class == $signal and kind == review_completed and subject == task and
          outcome == approved
        uses: core/enqueue-merge
        transition:
          target: task
          status: done
```

## Contract-Level Review After Task Work

```yaml
kind: flow
id: feature-branch-review
status: active
scope: contract

jobs:
  implement_ready_tasks:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: core/setup-worktree
      - uses: core/codex-exec
      - await:
          $class == $signal and kind == worker_completed and subject == task
      - if:
          $class == $signal and kind == worker_completed and subject == task and
          outcome == success
        transition:
          target: task
          status: done

  review_feature:
    needs: [implement_ready_tasks]
    if:
      none($class == task and tracked_in == @document and status not in [done,
      dropped])
    steps:
      - name: Request feature review
        uses: core/request-review
        with:
          reviewer: human
        transition:
          target: document
          status: review
```

## Runtime Query Pattern

The same query language can address durable workflow state and machine-local
runtime state.

```yaml
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

## Ordered Step Execution In One Worktree

Worktree policy selects assignment or reuse mode for the whole job. Ordinary
steps then execute in the declared order inside that assigned worktree.

```yaml
jobs:
  implement_ready_tasks:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: core/lease-task
      - run: npm ci
      - uses: core/codex-sdk
      - run: npm test
      - await:
          $class == $signal and kind == worker_completed and subject == task
```

In this slice:

- `run` and `uses` are ordinary steps in the same ordered list.
- There is no special `worktree.prepare` or `worktree.cleanup` step form.
- Setup and cleanup are expressed as ordinary steps when the flow author wants
  them.
- A failing step halts the job and leaves the assigned worktree in place for
  operator follow-up.

## Flow Shape Summary

```json
{
  "top_level_keys": ["kind", "id", "status", "scope", "jobs"],
  "job_keys": ["select", "needs", "if", "worktree", "steps"],
  "step_keys": [
    "name",
    "uses",
    "run",
    "with",
    "if",
    "await",
    "transition",
    "relate"
  ]
}
```
