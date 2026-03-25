---
Kind: plan
Id: patram-0.5-config-migration
Status: active
---

# Patram 0.5 Config Migration Plan

## Goal

- Upgrade Pravaha to `patram@0.5.0`.
- Migrate the repo config from top-level `class_schemas` to
  `classes.<name>.schema`.

## Scope

- Update package metadata and the lockfile to Patram `0.5.0`.
- Rewrite `.patram.json` to the `0.5.0` config shape without changing the repo's
  workflow semantics.
- Update tests and workflow docs that still describe the `0.4.0` config.

## Acceptance

- `patram check` passes with Patram `0.5.0`.
- Patram query fixtures still return the expected semantic ids.
- Repo docs describe the grouped class schema layout.
