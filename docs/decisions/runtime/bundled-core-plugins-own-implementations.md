---
Kind: decision
Id: bundled-core-plugins-own-implementations
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Bundled Core Plugins Own Implementations

- Keep `core/<name>` as the checked-in public plugin namespace in `v0.1`.
- Resolve `core/<name>` to bundled plugin modules that export the same named
  `definePlugin({...})` values as any other step plugin.
- Remove placeholder core plugin definitions whose runtime behavior lives in
  separate engine-owned switch statements.
- Remove `core/agent` and `core/codex-sdk`.
- Introduce `core/run-codex` as the bundled Codex execution plugin.
- Implement `core/run-codex` by launching `codex exec` as a subprocess instead
  of using `@openai/codex-sdk`.
- Keep subprocess execution plugin-owned. Plugins may call OS process APIs
  directly as ordinary implementation detail.
- Keep the public plugin `context` narrow and workflow-native. Do not add a
  general process execution API to `context`.
- Keep `context.dispatchFlow(...)` as an explicit runtime-native helper because
  downstream flow dispatch must stay part of Pravaha's durable execution model.
- Let bundled plugins add plugin-local `with` schemas instead of forcing a
  shared process-launch input shape across all plugins.
- Treat this shift as a breaking checked-in flow change. Do not add
  compatibility aliases or deprecation shims for removed core plugins.

## Rationale

- Keeping `core/<name>` preserves one clear checked-in flow surface while still
  removing the architectural split between fake plugin definitions and hidden
  runtime behavior.
- Real bundled plugin modules keep core integrations honest: if a capability
  belongs to plugin behavior, it should live in the plugin implementation.
- Launching `codex exec` keeps Pravaha aligned with the supported CLI surface
  and removes a heavier SDK-specific runtime path.
- A narrow plugin context avoids turning Pravaha into a general process broker
  when plugin modules can already own subprocess policy and output shaping.
- Keeping `dispatchFlow(...)` on context isolates the one runtime-native
  integration that must remain coupled to durable execution records.
