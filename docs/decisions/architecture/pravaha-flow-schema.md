---
Kind: decision
Id: pravaha-flow-schema
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Schema

- Define Pravaha flows as JavaScript modules that export
  `default defineFlow({...})`.
- Require each flow module to declare metadata through `defineFlow({...})` and
  to provide one `main` handler.
- Limit `v0.1` flow composition to one root flow document per contract and keep
  subflow composition out of scope.
- Keep trigger and workspace declarations in `defineFlow({...})` metadata.
- Bind the matched document through runtime `ctx.bindings`.
- Use imported built-ins such as `run(ctx, ...)`, `runCodex(ctx, ...)`,
  `approve(ctx, ...)`, and `worktreeHandoff(ctx, ...)` instead of checked-in
  graph nodes.
- Re-enter waits only through named handlers such as `onApprove(ctx, data)`.

## Rationale

- One checked-in JavaScript module keeps metadata and executable behavior in one
  authoring surface.
- Imported built-ins preserve a narrow runtime-owned seam without keeping a
  second checked-in schema for jobs and steps.
