---
Kind: task
Id: upgrade-patram-config
Status: done
Tracked in: docs/contracts/workflow/patram-0.5-config-migration.md
Implements: docs/contracts/workflow/patram-0.5-config-migration.md
Decided by: docs/decisions/workflow/patram-0.5-config-grouping.md
---

# Upgrade Patram Config

- Add or update tests so they describe the `patram@0.5.0` config shape.
- Migrate `.patram.json` from top-level `class_schemas` to
  `classes.<name>.schema`.
- Upgrade the Patram dependency and validate the repo end to end.
