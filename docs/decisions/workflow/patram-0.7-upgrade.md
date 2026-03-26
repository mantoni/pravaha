---
Kind: decision
Id: patram-0.7-upgrade
Status: accepted
Tracked in: docs/plans/repo/v0.1/patram-0.7-upgrade.md
---

# Patram 0.7 Upgrade

- Upgrade this repo to `patram@0.7.0`.
- Preserve the current semantic workflow classes, relations, stored queries, and
  Pravaha library entrypoints unless the released Patram surface forces an
  explicit compatibility fix.
- Treat `patram check`, the repo validation command, and the existing runtime
  tests as the compatibility gate for the release.

## Rationale

- `patram@0.7.0` is the current published release and keeps the same Node engine
  floor used by Pravaha.
- The exported CLI entrypoint and root library entrypoint remain available in
  the published package, so the upgrade should stay narrow unless validation
  exposes a behavioral change.
