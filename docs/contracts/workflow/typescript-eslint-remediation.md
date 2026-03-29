---
Kind: contract
Id: typescript-eslint-remediation
Status: done
Decided by: docs/decisions/workflow/typescript-eslint-remediation.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/typescript-eslint-remediation.md
  - docs/contracts/workflow/typescript-eslint-setup.md
---

# TypeScript ESLint Remediation

## Intent

- Resolve the repo's `typescript-eslint` violations without changing the lint
  policy established in the setup slice.

## Inputs

- The current Pravaha source tree under the active `typescript-eslint` config.
- The repo coding conventions for naming, async control flow, and JSDoc typing.
- The `npx eslint .` report produced after the setup slice.

## Outputs

- Source and test files updated so the current `typescript-eslint` rules pass.
- Any touched runtime behavior preserved by targeted validation.
- Repo validation restored under `npm run all`.

## Side Effects

- Broad source edits across runtime code, tests, scripts, and type files.
- Minor naming changes where the code currently uses non-conforming local
  identifiers.

## Invariants

- The `typescript-eslint` config remains materially unchanged.
- No broad lint disables or ignore comments are introduced to hide violations.
- Runtime semantics stay stable.

## Failure Modes

- Async wrappers are changed in ways that alter observable behavior.
- Naming fixes accidentally change public surfaces instead of local variables.
- Unsafe `any` flows are hidden instead of narrowed or typed explicitly.

## Review Gate

- `npx eslint .` passes.
- `npx tsc` passes.
- `npx prettier --write` has been run on touched files.
- `npm run all` passes.
