---
Kind: plan
Id: static-dead-code-analysis
Status: done
Depends on:
  - docs/conventions/repository/repo-plan-versioning.md
  - docs/conventions/workflow/patram-workflow-metadata.md
---

# Static Dead Code Analysis Plan

## Goal

- Add `knip` to the repository so Pravaha can detect dead code as part of its
  standard validation flow.

## Scope

- Record the governing workflow decision and contract for static dead-code
  analysis.
- Install and wire `knip` into package scripts and CI.
- Run `knip` once and report the findings for follow-up cleanup work.

## Acceptance

- `knip` is installed and runnable through an `npm` script.
- The main validation path and CI both execute the dead-code check.
- `npm run all` passes.
