---
Kind: decision
Id: patram-0.5-config-grouping
Status: accepted
Tracked in: docs/plans/repo/v0.1/patram-0.5-config-migration.md
---

# Patram 0.5 Config Grouping

- Upgrade this repo to `patram@0.5.0`.
- Move each class schema from top-level `class_schemas.<name>` into
  `classes.<name>.schema`.
- Preserve the existing semantic classes, fields, path classes, relations, and
  stored query behavior during the migration.

## Rationale

- Patram `0.5.0` rejects the legacy top-level `class_schemas` key.
- Keeping the same workflow semantics limits the migration to the released
  config shape change instead of mixing it with unrelated workflow changes.
