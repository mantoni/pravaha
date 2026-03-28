---
Kind: contract
Id: remove-compatibility-facades-and-colocate-tests
Status: done
Decided by: docs/decisions/architecture/remove-compatibility-facades-and-colocate-tests.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/remove-compatibility-facades-and-colocate-tests.md
---

# Remove Compatibility Facades And Colocate Tests

## Intent

- Make the repository's module graph reflect the canonical implementation layout
  without backwards-compatible facade files.

## Inputs

- The current `lib/` tree after the subsystem split.
- Existing tests that still import migrated modules through root-level paths or
  live outside the owning subsystem directory.
- The package root export surface that remains intentionally public.

## Outputs

- Remaining compatibility-only facade files removed from `lib/`.
- Imports updated to target owning implementation modules directly.
- Migrated tests moved next to the modules they verify.
- Layout coverage updated so new compatibility facades fail fast.

## Side Effects

- File moves for tests and import-path churn across the touched modules.
- Breaking import-path changes for consumers that still reference removed facade
  files.

## Invariants

- Canonical implementation modules keep their runtime behavior.
- The package root export remains usable if it is the intended product surface.
- Repo validation and workflow metadata stay consistent after file moves.

## Failure Modes

- A deleted facade still has internal or test imports.
- Test moves break coverage because helper imports or mocks still target the old
  path.
- Layout checks allow new root-level compatibility files to reappear.

## Review Gate

- `npx vitest run` passes for touched tests.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `patram check` passes.
- `npm run all` passes.
