---
Kind: flow
Id: strict-runtime-resume
Status: active
---

# Strict Runtime Resume

This root flow captures the slice where unresolved runs resume from the exact
recorded job node and keep the same selected task, workspace, and next-branch
contract.

```yaml
kind: flow
id: strict-runtime-resume
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
    next:
      - if: ${{ result.outcome == "success" }}
        goto: done
      - goto: retry

  retry:
    uses: core/run
    with:
      command: printf ''
    limits:
      max-visits: 2
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
