---
Kind: plan
Id: config-schema-hard-cut
Status: active
Depends on:
  - docs/contracts/runtime/config-schema-hard-cut.md
  - docs/decisions/runtime/config-schema-hard-cut.md
  - docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
---

# Config Schema Hard Cut Plan

## Goal

- Remove config surface that no longer governs runtime behavior.
- Flatten default flow matching config so checked-in config declares the match
  array directly.

## Scope

- Remove legacy `plugins` support from Pravaha config and normalized config.
- Replace `flows.default_matches` with `flows: string[]`.
- Keep the dispatcher and repo validation wired to the normalized flow match
  array.
- Update checked-in config, fixtures, tests, and operator-facing examples to the
  new schema.
- Treat the change as a hard cut with no compatibility path or alias parsing.

## Acceptance

- Pravaha rejects `plugins` in checked-in config instead of accepting or
  defaulting it.
- Pravaha accepts `flows` only as an array of non-empty `.js` or `.mjs`
  paths/globs.
- Default flow matching still resolves fallback candidates from the configured
  `flows` array.
- Checked-in config and examples no longer use `plugins` or
  `flows.default_matches`.
- `npm run all` passes.
