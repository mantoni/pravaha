---
Kind: contract
Id: move-repo-level-tests-into-test
Status: done
Decided by: docs/decisions/architecture/move-repo-level-tests-into-test.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/move-repo-level-tests-into-test.md
---

# Move Repo-Level Tests Into Test

## Intent

- Keep repository-level tests in `test/` rather than the package root.

## Inputs

- The remaining root-level repo tests for package, workflow, and config
  contracts.
- The existing `test/` directory for non-colocated test support and fixtures.
- Repo validation and workflow metadata that still assume root-level test files.

## Outputs

- Root-level repo tests relocated into `test/`.
- Updated relative imports and layout assertions for the new test paths.
- Workflow metadata and related documentation aligned with the new structure.

## Side Effects

- File moves for repo-level tests and path updates inside the moved files.
- Validation commands and docs now reference `test/` paths for those files.

## Invariants

- The moved tests keep covering the same package and workflow contracts.
- Colocated subsystem tests under `lib/` remain where they are.
- Published package contents stay unchanged.

## Failure Modes

- Moved tests still resolve files relative to the old package-root location.
- Layout checks continue to allow root-level test files to reappear.
- Workflow tooling keeps scanning only the old root-level test glob.

## Review Gate

- `npx vitest run test` passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `patram check` passes.
- `npm run all` passes.
