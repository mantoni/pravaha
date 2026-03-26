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
  - docs/reference/runtime/validation-examples.md
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
- Implement a mixed query graph that combines checked-in Patram documents with
  machine-local runtime nodes.
- Implement trigger-driven reconciliation with manual resume.
- Implement task leasing gated by semantic `ready` states and dependency
  relations.
- Implement reusable worktree lifecycle support with prepare and cleanup steps.
- Implement one first-class Codex backend with local process supervision and
  run-to-completion worker sessions.
- Evaluate candidate Codex launch modes and choose the first backend based on
  local lifecycle control and observability.

## Acceptance

- Contracts can reference exactly one root flow document.
- Pravaha validates flow documents against the configured semantic role and
  state model.
- Flow jobs can use `select`, `needs`, `if`, `await`, `uses`, `run`,
  `transition`, and `relate` in the approved YAML format.
- Only documents in configured semantic `ready` states are leaseable.
- The runtime exposes mixed-graph runtime nodes through reserved `$...` classes.
- One task can be leased into one prepared worktree and executed through one
  locally supervised Codex worker.
- Reconciliation can be resumed manually after restart without losing shared
  workflow state.

## Sequencing

- Foundation is complete: flow documents, contract-to-flow binding, and repo
  semantic validation are in place.
- Completed executable slices:
  - hard-coded Codex SDK happy path
  - single-task interpreted reconciler
  - strict machine-local runtime persistence with manual resume
  - widened mixed-graph flow surface
  - job-level worktree policy
- Current next chunk: expose reserved machine-local runtime nodes more directly
  through the mixed graph and tighten their lifecycle semantics.
- Then add scheduler depth such as dependency barriers and multi-task runs.
- Then refine prepare and cleanup lifecycle behavior on top of the job-level
  worktree policy surface.
