---
Kind: plan
Id: typescript-eslint-remediation
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/typescript-eslint-setup.md
---

# TypeScript ESLint Remediation Plan

## Goal

- Bring Pravaha back to a clean lint state under the new `typescript-eslint`
  flat config adopted in the setup slice.

## Scope

- Fix the repo's current `typescript-eslint` violations in runtime code, tests,
  scripts, and typed declaration files.
- Preserve existing behavior while making the code explicit enough for
  type-aware linting.
- Keep lint configuration stable unless a repo-local path adjustment is required
  for correctness.

## Non-Goals

- Do not add new lint rules beyond the adopted `../patram` parity config.
- Do not mix unrelated refactors into the remediation.

## Acceptance

- `npx eslint .` passes.
- `npx tsc` passes.
- `npm run all` passes.
