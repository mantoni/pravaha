---
Kind: plan
Id: pravaha-flow-runtime
Status: active
Depends on:
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/pravaha-flow-examples.md
  - docs/reference/runtime/codex-backend-evaluation.md
  - docs/reference/runtime/trigger-catalog.md
  - docs/reference/runtime/worktree-lifecycle.md
  - docs/reference/runtime/runtime-node-model.md
  - docs/reference/runtime/glossary.md
  - docs/reference/runtime/end-to-end-walkthrough.md
---

# Pravaha Flow Runtime Plan

## Goal

- Add the first executable Pravaha architecture for contract-bound flows,
  task-based leasing, and a local Codex-backed runtime on top of Patram.

## Scope

- Add repo decisions for flow documents, semantic role and state mapping, and
  the trigger-driven local runtime model.
- Extend the repository workflow model to support a `flow` document class and an
  explicit contract-to-flow relation.
- Add one repo-level Pravaha JSON config file for semantic roles and semantic
  states.
- Implement YAML loading and strict validation for Pravaha flow documents.
- Implement a canonical current-truth run snapshot that combines checked-in
  workflow inputs with one machine-local durable execution snapshot per live
  task.
- Implement checkpointed re-entry from durable job-boundary and wait snapshots
  instead of exact worker-session recovery.
- Implement task leasing gated by semantic `ready` states and dependency
  relations.
- Implement job-level worktree assignment or reuse and execute ordinary ordered
  job steps inside the assigned worktree.
- Implement one first-class Codex backend with local process supervision and
  run-to-completion worker sessions.
- Evaluate candidate Codex launch modes and choose the first backend based on
  local lifecycle control and observability.

## Acceptance

- Contracts can reference exactly one root flow document.
- Pravaha validates flow documents against the configured semantic role and
  state model.
- Flow jobs use the state-machine YAML shape with one `uses` or `end` node per
  job, optional `with`, optional `limits`, and `next` branching on non-terminal
  jobs.
- Only documents in configured semantic `ready` states are leaseable.
- The runtime exposes one canonical durable run snapshot instead of requiring
  separate persisted runtime-node classes.
- One task can be leased into one prepared worktree and executed through one
  locally supervised Codex worker.
- Interruption never requires mid-visit worker recovery. Durable job-boundary
  and wait checkpoints remain sufficient to continue safely.

## Sequencing

- Foundation is complete: flow documents, contract-to-flow binding, and repo
  semantic validation are in place.
- Completed executable slices:
  - single-task interpreted reconciler
  - strict machine-local runtime persistence for explicit crash recovery
  - widened mixed-graph flow surface
  - job-level worktree policy
  - scheduler depth with single-flight `needs` barriers
  - ordered ordinary step execution inside the assigned worktree
- Current next chunk: collapse durable runtime persistence to one canonical
  current-truth run snapshot and tighten checkpoint semantics around waits and
  completed job visits.
- Keep worktree setup and cleanup as ordinary checked-in steps instead of
  special lifecycle hooks in `v0.1`.
