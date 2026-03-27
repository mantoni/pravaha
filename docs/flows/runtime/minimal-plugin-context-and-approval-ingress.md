---
Kind: flow
Id: minimal-plugin-context-and-approval-ingress
Status: active
---

# Minimal Plugin Context And Approval Ingress

This root flow captures the narrow runtime slice where plugins receive a small
stable `context` contract and may pause one plugin-backed job through
`core/approval` until the operator resumes that run through
`pravaha approve --token <run_id>`.

```yaml
kind: flow
id: minimal-plugin-context-and-approval-ingress
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
  review:
    uses: core/approval
    with:
      title: Review ${{ task.path }}
      message: Approve or reject this task.
      options: [approve, reject]
    next:
      - if: ${{ result.verdict == "approve" }}
        goto: done
      - goto: rejected

  done:
    end: success

  rejected:
    end: failure
```
