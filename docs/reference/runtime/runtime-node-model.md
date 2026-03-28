---
Kind: reference
Id: runtime-node-model
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Run Snapshot Model

This document captures the working model for durable local runtime state under
the state-machine engine.

## Canonical Durable Shape

```json
{
  "run_snapshot": [
    "task_id",
    "task_path",
    "flow_path",
    "run_id",
    "current_job_name",
    "status",
    "job_outputs",
    "job_visit_counts",
    "wait"
  ]
}
```

## Role

The canonical run snapshot is the durable machine-local record for one live task
run. It preserves only the execution memory required to continue safely from the
latest checkpoint. Active worker, lease, and worktree ownership remain transient
operational state and are not part of the durable contract.

## Expected Shape

```json
{
  "run_snapshot": [
    "task_id",
    "task_path",
    "flow_document",
    "current_job_name",
    "job_outputs",
    "job_visit_counts",
    "status",
    "wait"
  ]
}
```

## Query Model

- Root-level `on.<binding>.where` still selects the durable document that owns
  one run snapshot.
- `next` expressions evaluate the current visit through `result`.
- Historical node data is exposed through `jobs.<name>.outputs`.
- Visit-count state remains durable because revisits and node-local limits are
  part of correct current execution truth.
- Separate durable runtime-node classes are no longer required for waits or
  other flow-visible runtime state.

## Example Branch

```yaml
next:
  - if: ${{ result.exit_code == 0 }}
    goto: done
  - goto: failed
```

This expression branches on the current job visit while the engine persists the
latest completed outputs for future jobs.
