---
Kind: decision
Id: move-repo-level-tests-into-test
Status: accepted
Tracked in: docs/plans/repo/v0.1/move-repo-level-tests-into-test.md
---

# Move Repo-Level Tests Into Test

- Keep repository-level configuration and package tests under `test/` instead of
  the package root.
- Preserve the existing colocated subsystem tests under `lib/` and only move the
  remaining repo-level test bucket.
- Update repo-relative imports, layout checks, and workflow metadata so the new
  `test/` location is the only supported home for those files.

## Rationale

- A dedicated repo-level test directory keeps the package root focused on
  runtime and configuration entrypoints.
- The move matches the existing repository convention that non-colocated tests
  live under `test/`.
