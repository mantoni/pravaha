---
Kind: contract
Id: package-api-jsdoc-declarations
Status: done
Decided by: docs/decisions/workflow/package-api-jsdoc-declarations.md
Depends on:
  - docs/conventions/workflow/patram-workflow-metadata.md
  - docs/plans/repo/v0.1/package-api-jsdoc-declarations.md
---

# Package API JSDoc Declarations

## Intent

- Publish Pravaha package declarations from source-adjacent JSDoc instead of
  hand-maintained package-root declaration files.

## Inputs

- The current npm package metadata and publish flow.
- The public `pravaha` and `pravaha/flow` package entrypoints.
- The `../patram/` package declaration build pattern.

## Outputs

- Pack lifecycle scripts and a package declaration emit config.
- JSDoc-owned public API types colocated with the flow and plugin contract
  implementations.
- Tests that verify packed declaration presence, consumer typechecking, and
  cleanup of generated artifacts.

## Side Effects

- `npm pack` generates transient declaration artifacts under `lib/`.
- Packed tarballs include generated `.d.ts` files for the published API surface.

## Invariants

- Generated declaration artifacts are not kept in the working tree after pack.
- Package consumers do not need repo-only `.ts` type sources.
- Public API typing remains aligned with the runtime implementation modules.

## Failure Modes

- Packed declarations reference `.ts` sources that are not shipped.
- Generated declaration artifacts leak into the working tree or get committed.
- The generated public entrypoint types no longer match the documented API
  surface.

## Review Gate

- `npx vitest run test/package-metadata.test.js test/package-install-smoke.test.js lib/flow/flow-contract.test.js lib/plugins/plugin-contract.test.js`
  passes.
- `npx tsc` passes.
- `npx eslint --fix` and `npx prettier --write` have been run on touched files.
- `npm run all` passes.
