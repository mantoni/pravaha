---
Kind: plan
Id: selective-source-metadata
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Selective Source Metadata Plan

## Goal

- Add a minimal, high-signal layer of source metadata so Patram can expose
  architectural touch-points through reverse references.

## Scope

- Record the selective annotation policy in a workflow decision and contract.
- Annotate only runtime boundary files with clear contract and decision
  ownership.
- Add integration coverage for `patram refs` on annotated targets.

## Acceptance

- `patram refs` on selected decisions and contracts resolves the annotated
  source files.
- The chosen annotations are limited to stable architectural boundaries.
- `npm run all` passes.
