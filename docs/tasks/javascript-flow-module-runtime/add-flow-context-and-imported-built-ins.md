---
Kind: task
Id: add-flow-context-and-imported-built-ins
Status: ready
Tracked in: docs/contracts/runtime/javascript-flow-module-runtime.md
Depends on:
  - docs/tasks/javascript-flow-module-runtime/add-javascript-flow-module-loading-and-validation.md
Implements: docs/contracts/runtime/javascript-flow-module-runtime.md
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
  - docs/decisions/runtime/bundled-core-plugins-own-implementations.md
---

# Add Flow Context And Imported Built-Ins

- Add the migrated flow `ctx` surface, including durable `state`,
  `await ctx.setState(...)`, run identity, repo paths, bound documents when
  present, and operator-facing console helpers.
- Expose bundled core behavior as imported flow functions such as
  `run(ctx, with)`, `runCodex(ctx, with)`, and `approve(ctx, with)`.
- Keep `ctx` as the first argument for bundled core functions and other
  plugin-backed flow functions.
- Route imported built-ins through the existing bundled core plugin
  implementations instead of introducing a second runtime-specific execution
  path.
