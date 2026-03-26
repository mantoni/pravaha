---
Kind: decision
Id: pluggable-step-plugins-and-signal-contracts
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pluggable Step Plugins And Signal Contracts

- Make `uses` step implementations pluggable in `v0.1`.
- Resolve `uses: local/<name>` from a standard repo-local plugin directory that
  Pravaha may override through checked-in Pravaha config.
- Resolve `uses: npm/<name>` from an installed npm package whose entrypoint
  provides the plugin implementation.
- Do not add a separate plugin registry layer. The `uses` value in the flow is
  the authoritative plugin reference.
- Require plugins to export a default `definePlugin(...)` contract from the
  `pravaha` package.
- Require each plugin to declare a machine-readable input contract through a Zod
  `with` schema or omit `with` entirely, in which case the flow may not provide
  `with` for that plugin.
- Require each plugin to declare emitted signal kinds as a map from signal name
  to Zod payload schema.
- Treat review, notification, ingress, and other interaction mechanics as
  ordinary plugin-backed steps instead of as built-in flow constructs.
- Restrict `await` validation to signal kinds emitted by plugins referenced in
  the same flow.

## Rationale

- Pluggable steps let Pravaha keep a small core while still allowing
  repo-specific and reusable npm-backed integrations.
- Encoding plugin identity directly in `uses` keeps checked-in policy
  self-contained and avoids a second indirection layer.
- One `definePlugin(...)` contract keeps plugin loading, validation, and
  documentation consistent.
- Required Zod schemas move plugin and signal compatibility checks into flow
  validation instead of delaying them until runtime.
- Treating human and external interactions as ordinary steps preserves one
  execution model across worker, review, and integration behavior.
