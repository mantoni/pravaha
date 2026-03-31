---
Kind: contract
Id: config-schema-hard-cut
Status: active
Decided by:
  - docs/decisions/runtime/config-schema-hard-cut.md
Depends on:
  - docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
Root flow: docs/flows/implement-task.js
---

# Config Schema Hard Cut

## Intent

- Remove legacy config that no longer drives plugin behavior.
- Flatten default flow matching config so the checked-in config declares the
  fallback match array directly.

## Inputs

- The accepted config hard-cut decision.
- The existing default flow matching runtime behavior.
- The current checked-in config, fixtures, docs, and validation coverage.

## Outputs

- Pravaha config no longer accepts `plugins`.
- Pravaha config accepts `flows` only as an array of glob references to
  JavaScript flow modules.
- The normalized config surface no longer exposes plugin config.
- Dispatcher and repo validation continue to expand fallback candidates from the
  normalized `flows` array.
- Checked-in config, fixtures, and examples move to the new schema without
  compatibility parsing.

## Invariants

- Explicit contract flow references remain authoritative.
- Config order does not imply precedence across fallback candidates.
- Bundled and imported callable plugin usage does not depend on repo-local
  plugin directory config.

## Failure Modes

- Pravaha silently accepts removed `plugins` config and hides stale checked-in
  settings.
- Pravaha keeps accepting `flows.default_matches` and widens the breaking change
  into a silent alias.
- Runtime callers continue to depend on the removed normalized plugin config.

## Review Gate

- Checked-in `pravaha.json` uses `flows` as a direct array and omits `plugins`.
- Config validation rejects `plugins` and non-array `flows`.
- Default flow matching still schedules exactly one fallback match and still
  rejects ambiguous matches.
- `npm run all` passes.
