---
Kind: task
Id: upgrade-patram-to-0.8.0
Status: done
Tracked in: docs/contracts/workflow/patram-0.8-upgrade.md
Implements: docs/contracts/workflow/patram-0.8-upgrade.md
Decided by: docs/decisions/workflow/patram-0.8-upgrade.md
---

# Upgrade Patram To 0.8.0

- Update tests and package assertions so they describe the `patram@0.8.0`
  dependency.
- Upgrade the Patram dependency and refresh the lockfile.
- Inspect the reverse-reference lookup surface against Pravaha's workflow graph.
- Add or adjust compatibility coverage only if the released `0.8.0` behavior
  breaks the existing repo invariants.
- Recommend source metadata touch-points only if the new reverse lookup makes
  them materially useful.

## Inspection Notes

- `patram show <file>` now includes an incoming-reference summary for the shown
  node.
- `patram refs <file>` expands incoming references grouped by relation and
  supports `--where` filtering on the incoming nodes.
- The feature is immediately useful on existing workflow docs.
- No source metadata was added in this upgrade slice because the repo benefits
  most from selective boundary annotations rather than broad file-level tagging.
