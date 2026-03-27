---
Kind: flow
Id: codex-sdk-happy-path
Status: active
---

# Codex SDK Happy Path

This root flow captures the checked-in happy-path runtime slice. The engine
binds one flow-level workspace for the whole run and advances the happy path
through explicit action jobs instead of an ordered step list.

```yaml
kind: flow
id: codex-sdk-happy-path
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
  prepare_workspace:
    uses: core/run
    with:
      command: 'true'
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: implement_task
      - goto: failed

  implement_task:
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
    next:
      - if: ${{ result.outcome == "success" }}
        goto: finalize_workspace
      - goto: failed

  finalize_workspace:
    uses: core/run
    with:
      command: "printf ''"
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
