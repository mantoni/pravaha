---
Kind: decision
Id: selective-source-metadata
Status: accepted
Tracked in: docs/plans/repo/v0.1/selective-source-metadata.md
---

# Selective Source Metadata

- Add Patram source metadata only on stable boundary modules with one clear
  architectural responsibility.
- Use source metadata to point from code to governing decisions and contracts.
- Prefer `Decided by` on architectural seams and use `Implements` only where one
  file is a primary implementation boundary for a contract.
- Do not add `Tracked in` to runtime code and do not annotate generic helpers,
  fixtures, or test support files.

## Rationale

- `patram@0.8.0` now exposes incoming references through `patram show` and
  `patram refs`, so one-way code annotations are now queryable from the target
  documents.
- Selective annotations keep the reverse graph readable and useful for impact
  analysis.
- Broad file-level tagging on shared helpers would create noisy many-to-many
  links that age poorly.
