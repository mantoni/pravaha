---
Kind: flow
Id: run-scoped-step-progress-and-plugin-signals
Status: active
---

# Run-Scoped Step Progress And Plugin Signals

This root flow captures the slice where plugin-backed jobs emit structured
results that later jobs in the same run may query and the runtime records
progress strongly enough to resume from the current job.

```yaml
kind: flow
id: run-scoped-step-progress-and-plugin-signals
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
  prepare:
    uses: core/run
    with:
      command: 'true'
    next:
      - if: ${{ result.exit_code == 0 }}
        goto: implement
      - goto: failed

  implement:
    uses: core/agent
    with:
      provider: codex-sdk
      prompt: Implement the task in ${{ task.path }}.
    next:
      - if: ${{ result.outcome == "success" }}
        goto: done
      - goto: failed

  done:
    end: success

  failed:
    end: failure
```
