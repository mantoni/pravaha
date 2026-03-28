---
Kind: plan
Id: remove-compatibility-facades-and-colocate-tests
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/code-structure-alignment.md
---

# Remove Compatibility Facades And Colocate Tests Plan

## Goal

- Finish the code-structure migration by deleting the remaining compatibility
  re-export modules and keeping tests next to the modules they verify.

## Scope

- Remove file-level compatibility facades that only re-export a canonical module
  without adding behavior.
- Update internal imports to target canonical implementation files directly.
- Move migrated tests beside their implementation files under the owning
  subsystem directory.
- Keep the package root entrypoint only if it remains the intended primary
  public surface rather than a temporary migration shim.

## Acceptance

- No compatibility-only re-export files remain in `lib/`.
- Tests for migrated modules live beside the owning implementation file instead
  of at the `lib/` root or in the repo-level `test/` directory.
- `npx vitest run` passes for touched modules and layout assertions.
- `patram check`, `npx tsc`, and `npm run all` pass.
