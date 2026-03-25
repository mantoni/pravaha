---
Kind: contract
Id: docs-structure-alignment
Status: done
Decided by: docs/decisions/workflow/semantic-contract-workflow.md
Depends on: docs/conventions/repository/docs-structure.md
---

# Docs Structure Alignment

## Intent

- Align the filesystem layout with the semantic contract workflow.

## Inputs

- Existing docs, Patram config, and repo guidance.

## Outputs

- Canonical class directories with no root-level workflow special cases.
- Tasks grouped under `docs/tasks/<contract-slug>/`.

## Side Effects

- Moved documentation paths and updated references.

## Invariants

- Semantic ids and graph relations remain the workflow source of truth.
- Repo evolution plans stay under `docs/plans/repo/v<major>.<minor>/`.

## Failure Modes

- Stale path references after the migration.
- Patram config and tests still expecting old root-level locations.

## Review Gate

- `patram check` passes.
- Patram tests cover the updated path rules.
- Repo guidance matches the migrated layout.
