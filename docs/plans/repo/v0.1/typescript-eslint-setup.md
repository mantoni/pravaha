---
Kind: plan
Id: typescript-eslint-setup
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# TypeScript ESLint Setup Plan

## Goal

- Align Pravaha's ESLint setup with the checked-in `../patram` flat config
  pattern so this repo can inspect the same type-aware lint surface.

## Scope

- Add the governing workflow decision and contract for the tooling change.
- Install `typescript-eslint` and downgrade `typescript` to a compatible major.
- Port the flat ESLint config structure from `../patram/eslint.config.js` with
  repo-local path adjustments only.
- Update `tsconfig.json` so the repo's checked-in `.ts` type files participate
  in type-aware linting.

## Non-Goals

- Do not fix any new lint findings exposed by the configuration change.
- Do not change runtime behavior or package exports.

## Acceptance

- `typescript-eslint` is present as a dev dependency.
- `typescript` is downgraded to the version line used by `../patram`.
- `eslint.config.js` matches the `../patram` flat config structure aside from
  repo-specific path differences.
- `tsconfig.json` includes the repo's `.ts` files so type-aware linting can load
  them.
- Validation results are recorded even if repo-wide lint now reports existing
  violations for later inspection.
