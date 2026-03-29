---
Kind: plan
Id: move-repo-level-tests-into-test
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Move Repo-Level Tests Into Test Plan

## Goal

- Move the remaining root-level test files into `test/` and keep the repo root
  free of ad hoc test buckets.

## Scope

- Relocate the repo-level `*.test.js` files from the package root into `test/`.
- Update repo-relative imports and filesystem expectations in the moved tests.
- Align layout assertions and workflow metadata with the new test location.

## Acceptance

- The package root no longer contains repo-level `*.test.js` files.
- The moved tests execute from `test/` without path regressions.
- `npx vitest run test`, `patram check`, `npx tsc`, and `npm run all` pass.
