---
Kind: contract
Id: javascript-flow-module-runtime
Status: active
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
  - docs/decisions/runtime/bundled-core-plugins-own-implementations.md
Depends on:
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/contracts/runtime/runtime-node-lifecycle.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
---

# JavaScript Flow Module Runtime

## Intent

- Support only JavaScript flow modules whose exported handlers are the runtime
  truth for checked-in Pravaha flows.

## Inputs

- The accepted JavaScript flow module decision that makes `defineFlow({...})`
  the checked-in flow asset shape.
- The canonical current-truth run snapshot and wait persistence model.
- The local dispatch runtime that still owns trigger matching, instance
  scheduling, and workspace assignment.
- Bundled core plugin implementations that can back imported flow functions.
- Root flows checked in as ECMAScript modules that export
  `default defineFlow({...})`.

## Outputs

- Runtime loading and validation for JavaScript flow modules that declare
  declarative metadata plus executable handlers.
- Validation that requires one `main` handler and allows optional named re-entry
  handlers such as `onApprove` plus optional `onError`.
- Runtime support that loads the flow module itself to discover `on`,
  `workspace`, and handlers.
- Runtime support that invokes the current handler from the top with one flow
  `ctx` object instead of interpreting `jobs`, `uses`, and `next`.
- A public flow context that exposes the current durable `state`,
  `await ctx.setState(...)`, and the existing runtime-native fields needed by
  migrated flows such as run id, repo paths, bound documents when present, and
  operator-facing console output.
- Imported built-in flow functions such as `run(ctx, with)`,
  `runCodex(ctx, with)`, and `approve(ctx, with)` backed by bundled core plugin
  implementations.
- Runtime support that routes uncaught handler failures to `onError(ctx, error)`
  when exported and otherwise treats them as terminal failure.
- Runtime support that persists approval wait state and later re-enters through
  `onApprove(ctx, data)`.

## Side Effects

- Scheduler and validation work must load checked-in user modules instead of
  reading fully static flow metadata.
- Replayed handlers may repeat side effects that already happened before the
  latest durable checkpoint.
- Waiting flow instances may resume under newer checked-in code than the code
  that created the wait.
- Flow logic becomes less statically inspectable because control flow lives in
  general JavaScript rather than in checked-in graph data.

## Invariants

- Triggers remain declared through `defineFlow({...})` metadata rather than
  through runtime calls inside handlers.
- Workspace policy remains declared through flow metadata and continues to bind
  one resolved workspace to one flow instance at a time.
- Checked-in flows do not declare YAML `jobs`, `steps`, `uses`, `next`, or other
  engine-owned graph control fields.
- Pravaha loads the flow module directly to discover metadata and handlers. It
  does not require purely static metadata extraction for migrated flows.
- `main(ctx)` is the required initial handler for a new flow instance.
- Re-entry after a persistent wait always enters a named handler such as
  `onApprove(ctx, data)` and never resumes on the next JavaScript line after the
  wait call.
- Re-entry after interruption or process loss restarts the current handler from
  the top using the latest durable snapshot instead of restoring the JavaScript
  stack.
- `ctx.setState(...)` is the explicit persistence boundary for durable flow
  state. In-memory mutations that are not persisted through `ctx.setState(...)`
  are not durable.
- Pravaha does not memoize prior built-in function results across replay.
- Imported built-in flow functions and plugin-backed functions receive `ctx` as
  their first argument.
- Built-in functions throw on failure. Recovery inside the flow happens only
  through user-land `try` / `catch` or the exported `onError` handler.
- A flow instance may have at most one outstanding persistent wait at a time in
  `v0.1`.
- Approval wait payload data is stored in the run snapshot and passed into
  `onApprove`.
- Re-entry after approval uses the latest checked-in flow module and not a
  revision-pinned copy.

## Public Surface

- `defineFlow({...})` accepts declarative flow metadata plus executable
  handlers.
- `defineFlow({...}).main` is required.
- `defineFlow({...}).onApprove` is optional and required only when the flow uses
  `approve(ctx, ...)`.
- `defineFlow({...}).onError` is optional.
- `ctx.state` exposes the latest durable flow state snapshot.
- `await ctx.setState(next_state)` durably replaces or updates flow state before
  later replay or re-entry.
- `run(ctx, with)` delegates to the bundled subprocess-backed core execution
  path and throws on failure.
- `runCodex(ctx, with)` delegates to the bundled Codex execution path and throws
  on failure.
- `approve(ctx, with)` records one pending approval wait and returns only
  through later `onApprove(ctx, data)` re-entry.

## Failure Modes

- Validation accepts checked-in YAML flow documents instead of requiring
  JavaScript modules.
- Pravaha resumes after approval by continuing `main` on the next line instead
  of re-entering through `onApprove`.
- Replay skips earlier built-in calls or memoizes old results even though the
  durable model is replay-from-top with repeated side effects.
- Flow state survives replay without an explicit `ctx.setState(...)` call and
  authors cannot reason about durability boundaries.
- Built-in flow functions hide runtime services in ambient globals instead of
  taking `ctx` explicitly.
- Multiple waits can be left pending for one flow instance and later ingress
  becomes ambiguous.
- Uncaught errors bypass `onError` when the flow exports it.
- Waiting instances are pinned to an older module revision and diverge from the
  chosen latest-code resume model.

## Review Gate

- A valid JavaScript flow module exporting `default defineFlow({...})` loads and
  validates successfully.
- Missing `main` fails validation clearly.
- Migrated flows that still declare legacy graph fields fail validation clearly.
- `ctx.state` is available in handlers and changes become durable only through
  `await ctx.setState(...)`.
- After interruption, Pravaha restarts the current handler from the top using
  the latest durable state snapshot.
- Replayed handlers re-run prior built-in calls unless the flow has guarded them
  with durable state.
- `approve(ctx, ...)` stores one pending wait and later re-enters through
  `onApprove(ctx, data)` under the latest checked-in code.
- Flow instances cannot hold more than one outstanding persistent wait.
- Imported built-in flow functions receive `ctx` as their first argument.
- Uncaught handler failures route to `onError(ctx, error)` when exported.
- `npm run all` passes.
