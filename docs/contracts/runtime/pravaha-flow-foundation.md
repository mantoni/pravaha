---
Kind: contract
Id: pravaha-flow-foundation
Status: active
Decided by: docs/decisions/architecture/flow-documents-and-contract-binding.md
Decided by: docs/decisions/architecture/semantic-role-config-and-state-model.md
Decided by: docs/decisions/runtime/trigger-driven-codex-runtime.md
Depends on: docs/conventions/workflow/patram-workflow-metadata.md
Depends on: docs/conventions/repository/docs-structure.md
Depends on: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Foundation

## Intent

- Add the minimum repository support required to define Pravaha flows as
  first-class workflow assets and bind contracts to one root flow.

## Inputs

- The accepted architecture decisions for flow documents, semantic role config,
  semantic state mapping, and the trigger-driven local runtime.
- The current Patram config, workflow queries, CLI placeholder, and repository
  test suite.

## Outputs

- A `flow` workflow document class in the repo model.
- An explicit contract-to-flow relation in the Patram model.
- One repo-level Pravaha JSON config surface for semantic roles and semantic
  states.
- Validation coverage for flow documents and Pravaha config.

## Side Effects

- Changes to Patram config, repo tests, and runtime scaffolding.
- New checked-in workflow documents for flow definitions and Pravaha config.

## Invariants

- Contracts remain the portable source of intent and reference exactly one root
  flow.
- Only semantic `ready` states are leaseable.
- Pravaha runtime classes stay engine-owned under the protected `$...`
  namespace.
- Flow documents use YAML as the approved machine-readable format.

## Failure Modes

- The repo accepts flow documents without enforcing contract ownership and
  semantic role constraints.
- Pravaha config and flow validation drift apart so flows cannot be validated
  deterministically.
- Patram relations and tests keep the old workflow model and reject the new flow
  surface.

## Review Gate

- Patram accepts the new workflow document and relation surfaces.
- Repo tests cover the new flow class, contract-to-flow relation, and Pravaha
  config validation rules.
- `npm run all` passes.
