---
Kind: contract
Id: patram-0.8-upgrade
Status: done
Decided by: docs/decisions/workflow/patram-0.8-upgrade.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/patram-0.8-upgrade.md
---

# Patram 0.8 Upgrade

## Intent

- Keep Pravaha executable with Patram `0.8.0` and evaluate whether the new
  reverse-reference lookup makes selective source metadata worth adding.

## Inputs

- The published Patram `0.8.0` CLI and library package surface.
- The current Pravaha package metadata, workflow config, runtime code, and
  tests.
- The repo convention for optional source metadata in JSDoc.

## Outputs

- Patram dependency ranges updated to `0.8.0`.
- Lockfile and installed package metadata aligned with the new release.
- Tests and docs updated where they assert the Patram version directly.
- One concrete assessment of the reverse-reference lookup behavior in this repo.
- Any narrow compatibility fix required for `patram@0.8.0` to pass the repo's
  validation gates.

## Side Effects

- Lockfile changes from the dependency upgrade.
- Potential test updates if Patram `0.8.0` changes validated output while
  preserving repo semantics.

## Invariants

- Semantic workflow classes, ids, relations, and stored queries stay stable.
- Pravaha continues to use the Patram CLI and library entrypoints already
  encoded in the repo.
- Source metadata is only added if the new reverse lookup exposes clear
  architectural value.

## Failure Modes

- Direct version assertions remain on `0.7.0`.
- Patram `0.8.0` changes validation or library behavior in a way the runtime
  does not tolerate.
- Reverse-reference lookup works in principle but remains too noisy to justify
  source metadata in this repo.
- Repo validation passes in unit tests but fails under `npm run all`.

## Review Gate

- `npx vitest run test/package-metadata.test.js test/husky-config.test.js`
  passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
