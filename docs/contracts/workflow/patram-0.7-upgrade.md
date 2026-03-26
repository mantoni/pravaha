---
Kind: contract
Id: patram-0.7-upgrade
Status: done
Decided by: docs/decisions/workflow/patram-0.7-upgrade.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/patram-0.7-upgrade.md
---

# Patram 0.7 Upgrade

## Intent

- Keep Pravaha executable with Patram `0.7.0`.

## Inputs

- The published Patram `0.7.0` CLI and library package surface.
- The current Pravaha package metadata, workflow config, runtime code, and
  tests.

## Outputs

- Patram dependency ranges updated to `0.7.0`.
- Lockfile and installed package metadata aligned with the new release.
- Tests and docs updated where they assert the Patram version directly.
- Any narrow compatibility fix required for `patram@0.7.0` to pass the repo's
  validation gates.

## Side Effects

- Lockfile changes from the dependency upgrade.
- Potential snapshot-like test updates if Patram `0.7.0` changes validated
  output while preserving repo semantics.

## Invariants

- Semantic workflow classes, ids, relations, and stored queries stay stable.
- Pravaha continues to use the Patram CLI and library entrypoints already
  encoded in the repo.

## Failure Modes

- Direct version assertions remain on `0.6.2`.
- Patram `0.7.0` changes validation or library behavior in a way the runtime
  does not tolerate.
- Repo validation passes in unit tests but fails under `npm run all`.

## Review Gate

- `npx vitest run test/package-metadata.test.js test/husky-config.test.js`
  passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
