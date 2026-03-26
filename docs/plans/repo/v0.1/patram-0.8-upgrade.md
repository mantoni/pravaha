---
Kind: plan
Id: patram-0.8-upgrade
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Patram 0.8 Upgrade Plan

## Goal

- Upgrade Pravaha to `patram@0.8.0` while preserving the repo's workflow model
  and library integration points.
- Evaluate the new reverse-reference lookup against Pravaha's docs-first graph
  and decide where source metadata would add architectural value.

## Scope

- Add the governing workflow decision, contract, and task for the upgrade.
- Update package metadata and the lockfile to Patram `0.8.0`.
- Align tests and docs with the new Patram version where the repo asserts it
  directly.
- Inspect the new reverse-reference lookup with representative Pravaha
  documents.
- Add selective source metadata only if the new lookup makes those references
  meaningfully discoverable.

## Acceptance

- `npx vitest run` passes for the touched Patram package assertions and any
  regression coverage needed by the upgrade.
- `npx tsc` passes.
- `patram check` still passes for the repo workflow graph under `0.8.0`.
- `npm run all` passes.
