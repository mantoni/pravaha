---
Kind: contract
Id: static-dead-code-analysis
Status: done
Decided by: docs/decisions/workflow/static-dead-code-analysis.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/static-dead-code-analysis.md
---

# Static Dead Code Analysis

## Intent

- Add a repeatable dead-code analysis check to the repository and use it to
  surface cleanup candidates.

## Inputs

- The current Pravaha package metadata, scripts, CI workflow, and source tree.
- `knip` static analysis for unused files, exports, and dependencies.

## Outputs

- `knip` installed as a dev dependency.
- A dedicated `npm` script for dead-code analysis included in the main
  validation path.
- CI coverage for the dead-code check on the primary validation Node version.
- One recorded `knip` run with its reported cleanup candidates handed back to
  the user.

## Side Effects

- Lockfile changes from the new dev dependency.
- Validation now fails when `knip` reports unused code or dependencies.

## Invariants

- Installing dead-code analysis does not change runtime behavior.
- Dead-code findings are reported explicitly before any cleanup work is
  attempted.
- Existing validation gates remain in place alongside the new check.

## Failure Modes

- `knip` is installed but not wired into the repo validation path.
- CI and local validation diverge on whether dead-code analysis runs.
- `knip` reports repository-specific false positives and no configuration is
  added to explain them.

## Review Gate

- `npx vitest run husky-config.test.js github-actions-config.test.js` passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
