---
Kind: plan
Id: javascript-flow-runtime
Status: active
Depends on:
  - docs/contracts/runtime/javascript-flow-module-runtime.md
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
  - docs/decisions/runtime/bundled-core-plugins-own-implementations.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
---

# JavaScript Flow Runtime Plan

## Goal

- Replace Pravaha's YAML flow and engine-owned job graph execution model with
  JavaScript flow modules whose exported handlers are the runtime truth.

## Scope

- Add JavaScript flow module loading around `default defineFlow({...})`.
- Replace legacy YAML flow validation for migrated flows with validation over
  flow metadata and handler presence in the loaded module.
- Keep trigger and workspace declarations in flow metadata while moving control
  flow into `main(ctx)` and named re-entry handlers.
- Add the public flow context surface for migrated flows, including durable
  `state`, `await ctx.setState(...)`, runtime-native bindings, and
  operator-facing console helpers.
- Expose bundled core capabilities as imported flow functions such as
  `run(ctx, with)`, `runCodex(ctx, with)`, and `approve(ctx, with)`.
- Route imported flow functions through the existing bundled core plugin
  implementations instead of maintaining a second execution path.
- Replace ordered-step and job-boundary resume for migrated flows with
  replay-from-top handler execution using the latest durable snapshot.
- Persist one outstanding wait plus wait payload data in the run snapshot and
  re-enter through named handlers such as `onApprove(ctx, data)`.
- Route uncaught handler failures to `onError(ctx, error)` when the flow exports
  that handler.
- Migrate representative fixtures, examples, and validation coverage to the new
  JavaScript flow shape.

## Acceptance

- A checked-in JavaScript flow module exporting `default defineFlow({...})`
  validates and can be scheduled as a root flow.
- Migrated flows declare metadata plus handlers and no longer rely on YAML
  `jobs`, `steps`, `uses`, or `next`.
- `ctx.state` is visible to handlers and durability boundaries are explicit
  through `await ctx.setState(...)`.
- Imported built-in flow functions receive `ctx` as their first argument and
  throw on failure.
- Approval waits persist in the canonical run snapshot and re-enter through
  `onApprove(ctx, data)` under the latest checked-in module.
- After interruption, Pravaha restarts the current handler from the top with the
  latest durable state rather than resuming the JavaScript stack.
- Replayed handlers re-run earlier effectful built-ins unless the flow prevents
  duplication through durable state.
- Flow instances cannot keep more than one outstanding persistent wait in
  `v0.1`.
- Breaking change. No backward compatibility required for migrated flows.
- `npm run all` passes.

## Sequencing

- Phase 1: Flow asset and validation
  - Add module loading and the `defineFlow({...})` public contract.
  - Validate flow metadata, required `main`, optional named handlers, and the
    absence of legacy graph fields for migrated flows.
  - Decide how root flow references identify JavaScript flow assets in checked-
    in repo metadata.
- Phase 2: Flow context and imported built-ins
  - Add the migrated flow `ctx` surface, including durable `state`,
    `ctx.setState(...)`, repo paths, run identity, bound documents, and console
    helpers.
  - Adapt bundled core plugin implementations behind imported flow functions
    that take `ctx` first.
  - Preserve one explicit runtime-native path for downstream dispatch and other
    engine-coupled behavior that cannot become plain library code.
- Phase 3: Replay and wait semantics
  - Replace ordered-step progress semantics for migrated flows with handler
    replay from the latest durable snapshot.
  - Persist one outstanding wait plus wait payload data in the run snapshot.
  - Add approval re-entry through `onApprove(ctx, data)` and uncaught error
    routing through `onError(ctx, error)`.
  - Keep latest-code resume and repeated side effects as explicit runtime
    guarantees.
- Phase 4: Migration and hardening
  - Migrate representative runtime fixtures, examples, and root flows to the
    JavaScript module shape.
  - Tighten validation and diagnostics around replay, missing handlers,
    unsupported mixed legacy fields, and wait misuse.
  - Revisit adjacent runtime contracts that still assume YAML flow assets,
    ordered steps, or engine-owned job graphs.
