---
Kind: flow
Id: single-flight-scheduler-depth
Status: active
---

# Single-Flight Scheduler Depth

This root flow captures the state-machine slice where one implementation job
hands off into a narrow downstream review job without intra-flow fan-out.

```yaml
kind: flow
id: single-flight-scheduler-depth
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
    next:
      - if: ${{ result.outcome == "success" }}
        goto: review
      - goto: failed

  review:
    uses: core/approval
    with:
      title: Review ${{ task.path }}
      message: Approve or reject the implementation.
      options: [approve, reject]
    next:
      - if: ${{ result.verdict == "approve" }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
