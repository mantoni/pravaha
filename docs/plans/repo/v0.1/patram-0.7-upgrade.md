---
Kind: plan
Id: patram-0.7-upgrade
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Patram 0.7 Upgrade Plan

## Goal

- Upgrade Pravaha to `patram@0.7.0` while preserving the repo's workflow model
  and library integration points.

## Scope

- Add the governing workflow decision, contract, and task for the upgrade.
- Update package metadata and the lockfile to Patram `0.7.0`.
- Align tests and docs with the new Patram version where the repo asserts it
  directly.
- Validate that the Patram CLI and library APIs used by Pravaha still behave
  correctly under `0.7.0`.

## Acceptance

- `npx vitest run` passes for the touched Patram package assertions and any
  regression coverage needed by the upgrade.
- `npx tsc` passes.
- `patram check` still passes for the repo workflow graph under `0.7.0`.
- `npm run all` passes.
