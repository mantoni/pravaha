---
Kind: decision
Id: config-schema-hard-cut
Status: accepted
Tracked in: docs/plans/repo/v0.1/config-schema-hard-cut.md
---

# Config Schema Hard Cut

- Remove the legacy Pravaha config key `plugins`.
- Stop returning normalized plugin config from the config loader.
- Treat bundled and imported plugin resolution as configless in this slice.
- Replace `flows.default_matches` with `flows`.
- Replace the checked-in repo config file with `pravaha.config.js`.
- Require checked-in config modules to default-export `defineConfig(...)`.
- Export `defineConfig(config)` from `pravaha/config` and reserve the main
  `pravaha` entry point for runtime and plugin APIs.
- Define `flows` as one optional array of non-empty `.js` or `.mjs` paths/globs.
- Keep default flow matching behavior the same apart from the config shape.
- Reject the removed and replaced config shapes instead of providing
  compatibility aliases, defaults, or migration shims.

## Rationale

- The current `plugins` config no longer controls runtime behavior and should
  not remain as dead schema.
- `flows.default_matches` adds one unnecessary object layer around the only
  implemented flow match list.
- A JavaScript config module lets the public contract carry strict exported
  typing instead of relying on JSON-only validation after file load.
- A dedicated `pravaha/config` subpath keeps config authoring isolated from the
  main runtime entry point and makes the breaking API cut explicit.
- A hard cut keeps the checked-in config contract explicit and avoids carrying
  schema translation logic after the runtime has already moved on.
