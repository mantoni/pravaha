---
Kind: reference
Id: pravaha-runtime-architecture
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Runtime Architecture

This document captures the supporting architecture model behind the current
Pravaha decisions.

## Planes

- Patram is the control plane for shared, portable workflow state.
- The Pravaha runtime is the data plane for local execution, supervision, and
  transient operational state.
- Flow documents are the policy plane that define how work moves through the
  system.

```mermaid
graph TD
  A["Checked-in Patram graph<br/>contracts, tasks, decisions, flows"] --> B["Reconciler"]
  B --> C["Flow engine<br/>typed declarative YAML"]
  B --> D["Lease manager"]
  D --> E["Worktree pool<br/>named or ephemeral"]
  E --> F["Worker supervisor<br/>Codex run-to-completion workers"]
  F --> G["Local runtime store<br/>$flow_instance, $lease, $worktree, $worker, $signal"]
  C --> H["Review and integration actions"]
  H --> A
```

## Shared And Local State

- Shared workflow intent stays in checked-in Patram documents.
- Machine-local runtime state stays outside git, but remains queryable through
  the mixed runtime graph.

```json
{
  "portable_shared_truth": [
    "contracts",
    "tasks",
    "decisions",
    "flow references",
    "review and merge intent"
  ],
  "machine_local_runtime_truth": [
    "worker ownership",
    "worktree assignment",
    "current flow node",
    "pending waits",
    "heartbeats",
    "logs",
    "retries"
  ]
}
```

## Core Execution Loop

Pravaha reconciles durable workflow state with machine-local runtime state.

```mermaid
graph LR
  A["query ready leaseable documents"] --> B["acquire lease"]
  B --> C["assign or create worktree"]
  C --> D["prepare worktree"]
  D --> E["start Codex worker"]
  E --> F["emit runtime graph state"]
  F --> G["evaluate flow conditions"]
  G --> H["project explicit shared-state changes"]
```

## Key Constraints

- Contracts own exactly one root flow.
- The flow root is bound as `document`.
- A job `select` binds the selected durable document under its Patram class
  name, such as `task` or `ticket`.
- `jobs.<name>.select` only fans out over durable workflow documents.
- `if` and `await` may query both durable workflow documents and runtime nodes.
- Leasing is tied to the configured semantic `ready` state.
- One leased task or equivalent leaseable document occupies one worktree at a
  time.
- Workers are locally supervised run-to-completion processes.
