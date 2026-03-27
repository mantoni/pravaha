---
Kind: flow
Id: ordered-worktree-step-execution
Status: active
---

# Ordered Worktree Step Execution

This root flow captures the migrated slice where tasks run one declared sequence
of job nodes inside one assigned workspace without special lifecycle phases.

```yaml
kind: flow
id: ordered-worktree-step-execution
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
  install_dependencies:
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
        goto: run_tests
      - goto: failed

  run_tests:
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
