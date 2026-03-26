---
Kind: task
Id: upgrade-patram-to-0.7.0
Status: done
Tracked in: docs/contracts/workflow/patram-0.7-upgrade.md
Implements: docs/contracts/workflow/patram-0.7-upgrade.md
Decided by: docs/decisions/workflow/patram-0.7-upgrade.md
---

# Upgrade Patram To 0.7.0

- Update tests and package assertions so they describe the `patram@0.7.0`
  dependency.
- Upgrade the Patram dependency and refresh the lockfile.
- Add or adjust compatibility coverage only if the released `0.7.0` behavior
  breaks the existing repo invariants.
- Validate the repo end to end under Patram `0.7.0`.
