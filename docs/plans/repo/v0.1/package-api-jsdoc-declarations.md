---
Kind: plan
Id: package-api-jsdoc-declarations
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Package API JSDoc Declarations Plan

## Goal

- Generate published package declarations from source-adjacent JSDoc so the npm
  type surface stays aligned with implementation code.

## Scope

- Add a package-only declaration emit config and npm pack lifecycle scripts.
- Move public flow and plugin contract types into the implementation modules
  that own those contracts.
- Update publish metadata and smoke coverage so packed consumers receive the
  generated declarations.

## Acceptance

- `npm pack` produces the generated declaration files needed by package
  consumers.
- The checked-in working tree does not retain generated declaration artifacts
  after packing.
- Consumer TypeScript code can import the packed `pravaha` and `pravaha/flow`
  package surfaces without extra compiler flags.
- `npm run all` passes.
