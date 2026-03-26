---
Kind: decision
Id: patram-0.8-upgrade
Status: accepted
Tracked in: docs/plans/repo/v0.1/patram-0.8-upgrade.md
---

# Patram 0.8 Upgrade

- Upgrade this repo to `patram@0.8.0`.
- Preserve the current semantic workflow classes, relations, stored queries, and
  Pravaha library entrypoints unless the released Patram surface forces an
  explicit compatibility fix.
- Inspect the new reverse-reference lookup behavior and use that observed
  surface to decide whether source metadata should be added in Pravaha now.
- Treat `patram check`, the repo validation command, and the existing runtime
  tests as the compatibility gate for the release.

## Rationale

- `patram@0.8.0` adds the reverse-reference introspection surface this repo was
  waiting on before deciding whether code-level metadata is worth maintaining.
- The repo already has a stable docs-first workflow model, so the decision to
  add source metadata should be driven by observed query value rather than by
  convention alone.
