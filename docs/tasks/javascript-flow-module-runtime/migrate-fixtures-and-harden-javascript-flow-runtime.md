---
Kind: task
Id: migrate-fixtures-and-harden-javascript-flow-runtime
Status: done
Tracked in: docs/contracts/runtime/javascript-flow-module-runtime.md
Depends on:
  - docs/tasks/javascript-flow-module-runtime/add-javascript-flow-module-loading-and-validation.md
  - docs/tasks/javascript-flow-module-runtime/add-flow-context-and-imported-built-ins.md
  - docs/tasks/javascript-flow-module-runtime/add-handler-replay-and-wait-reentry.md
Implements: docs/contracts/runtime/javascript-flow-module-runtime.md
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
---

# Migrate Fixtures And Harden JavaScript Flow Runtime

- Migrate representative runtime fixtures, examples, and root flows to the
  JavaScript module shape.
- Add validation and diagnostics for missing handlers, mixed legacy graph
  fields, invalid wait usage, and replay-sensitive failure cases.
- Revisit adjacent runtime docs and tests that still assume YAML flow assets,
  ordered steps, or engine-owned job graphs for migrated flows.
- Keep the migration as a breaking change for migrated flows and remove
  compatibility expectations from affected examples and coverage.
