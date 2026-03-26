---
Kind: contract
Id: selective-source-metadata
Status: done
Decided by: docs/decisions/workflow/selective-source-metadata.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/selective-source-metadata.md
---

# Selective Source Metadata

## Intent

- Make Patram reverse references useful for architectural inspection in Pravaha
  by adding a small set of source metadata annotations on runtime boundary
  modules.

## Inputs

- Patram `0.8.0` reverse-reference lookup through `patram show` and
  `patram refs`.
- The current runtime contracts, decisions, and boundary modules.
- The repo convention for optional source metadata in JSDoc.

## Outputs

- Source metadata annotations on a curated set of boundary runtime modules.
- One integration test that proves decisions and contracts resolve back to those
  source files through `patram refs`.
- Repo workflow docs that capture the selective annotation policy.

## Side Effects

- `patram show` on annotated files surfaces outgoing links and an incoming
  summary.
- `patram refs` on the targeted decisions and contracts exposes the annotated
  implementation touch-points.

## Invariants

- Source metadata remains selective rather than exhaustive.
- Shared helpers without one clear architectural boundary remain unannotated.
- Existing workflow docs remain the primary source of execution state.

## Failure Modes

- Too many files are annotated and the reverse graph becomes noisy.
- The chosen files do not map cleanly to contracts or decisions and create
  misleading architecture links.
- The repo adds annotations but does not verify that Patram resolves them.

## Review Gate

- `npx vitest run test/source-metadata-refs.test.js` passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
