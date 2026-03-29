---
Kind: task
Id: separate-test-support-from-production-for-knip
Status: done
Tracked in: docs/contracts/workflow/static-dead-code-analysis.md
Implements: docs/contracts/workflow/static-dead-code-analysis.md
Decided by: docs/decisions/workflow/static-dead-code-analysis.md
---

# Separate Test Support From Production For Knip

- Move test-only fixtures, harnesses, and helper modules out of the published
  implementation tree under `lib/`.
- Update tests to import those fixtures from a dedicated repository-local test
  support tree.
- Remove production exports that exist only so tests can reach private module
  internals.
- Configure the production `knip` pass to judge only the publishable runtime
  surface while the full-repo `knip` pass still reports dead test fixtures.
