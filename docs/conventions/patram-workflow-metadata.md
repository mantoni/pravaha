---
Kind: convention
Status: active
---

# Patram Workflow Metadata

- Use front matter for machine-readable workflow metadata.
- Use headings and prose for contract content. Avoid free-form `Label: value`
  lines in the body because Patram still treats visible directive-shaped prose
  as metadata.
- Set `Kind` to the semantic class name.
- Set `Id` to the semantic slug only. Patram derives the canonical graph id as
  `<kind>:<id>`.
- Set `Status` on every contract, task, decision, convention, and plan.

## Contract Template

```md
---
Kind: contract
Id: example-contract
Status: active
Decided by: docs/decisions/example-decision.md
Depends on: docs/reference/example-reference.md
---

# Example Contract

## Intent

## Inputs

## Outputs

## Side Effects

## Invariants

## Failure Modes

## Review Gate
```

## Task Template

```md
---
Kind: task
Id: example-task
Status: ready
Tracked in: docs/contracts/example-contract.md
Depends on: docs/tasks/example-prerequisite.md
Implements: docs/contracts/example-contract.md
---

# Example Task
```

## Source Metadata

```js
/**
 * Example implementation.
 *
 * Tracked in: ../docs/contracts/example-contract.md
 * Implements: ../docs/tasks/example-task.md
 * Decided by: ../docs/decisions/example-decision.md
 * @patram
 */
```
