---
Kind: contract
Id: typescript-eslint-setup
Status: done
Decided by: docs/decisions/workflow/typescript-eslint-setup.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/typescript-eslint-setup.md
---

# TypeScript ESLint Setup

## Intent

- Give Pravaha the same `typescript-eslint` setup shape as `../patram` without
  mixing in cleanup of the violations that change reveals.

## Inputs

- The current Pravaha ESLint and TypeScript configuration.
- The reference config at `../patram/eslint.config.js`.
- The compatible dependency versions already proven in the sibling repo.

## Outputs

- `typescript-eslint` installed as a dev dependency.
- `typescript` downgraded to the compatible version line.
- `eslint.config.js` updated to the type-aware flat config structure used by
  `../patram`.
- `tsconfig.json` updated so the repo's `.ts` files are part of the configured
  project.

## Side Effects

- `package-lock.json` changes from dependency installation.
- Repo-wide lint may begin surfacing existing issues in files that were
  previously outside the lint rule set.

## Invariants

- No source fixes are included in this slice.
- Runtime code paths and package exports stay unchanged.
- Repo-specific config differences stay limited to local path adjustments.

## Failure Modes

- `typescript-eslint` is installed against an unsupported `typescript` version.
- Type-aware linting fails because checked-in `.ts` files remain outside the
  TypeScript project.
- The config copy drifts from `../patram` beyond the repo-local path changes.

## Review Gate

- `npx tsc` passes.
- `npx eslint .` has been run to expose the new lint surface, even if it reports
  existing violations.
- `npx prettier --write` has been run on touched files.
- `npm run all` has been run and any failures are reported.
