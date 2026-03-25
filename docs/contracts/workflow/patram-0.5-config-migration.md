---
Kind: contract
Id: patram-0.5-config-migration
Status: review
Decided by: docs/decisions/workflow/patram-0.5-config-grouping.md
Depends on: docs/conventions/workflow/patram-workflow-metadata.md
Depends on: docs/conventions/repository/repo-plan-versioning.md
---

# Patram 0.5 Config Migration

## Intent

- Keep Pravaha executable with Patram `0.5.0`.

## Inputs

- The released Patram `0.5.0` config loader and validator behavior.
- The current repo workflow docs, config, and tests.

## Outputs

- Patram dependency ranges updated to `0.5.0`.
- `.patram.json` migrated to grouped class schemas.
- Tests and docs aligned with the `0.5.0` config shape.

## Side Effects

- Lockfile changes from the dependency upgrade.

## Invariants

- Semantic class names and workflow query semantics stay stable.
- Workflow metadata still uses front matter plus relation directives.

## Failure Modes

- Hidden references to top-level `class_schemas` remain in tests or docs.
- The config shape changes but field and relation validation no longer matches
  the repo workflow.

## Review Gate

- `npx vitest run test/patram-config.test.js test/patram-queries.test.js`
  passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
