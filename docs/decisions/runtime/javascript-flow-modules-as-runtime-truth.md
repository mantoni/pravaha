---
Kind: decision
Id: javascript-flow-modules-as-runtime-truth
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# JavaScript Flow Modules As Runtime Truth

- JavaScript modules that export `default defineFlow({...})` from `pravaha/flow`
  are the only supported checked-in flow surface.
- Keep trigger bindings and workspace declarations in the `defineFlow(...)`
  config as declarative metadata fields such as `on` and `workspace`.
- Require each flow module to declare one `main` entrypoint. Allow optional
  named re-entry handlers such as `onApprove` and one generic `onError` handler.
- Let Pravaha load flow modules directly to discover metadata and handlers. Do
  not require trigger and workspace metadata to remain statically discoverable
  without executing user code.
- Treat JavaScript handler execution as the durable runtime truth instead of
  compiling flow modules into an engine-owned job graph.
- Allow unrestricted Node and library usage inside flow handlers. Do not
  constrain handler code to a statically analyzable subset.
- Keep Pravaha-owned durable operations as imported callable core plugins such
  as `run(ctx, ...)`, `runCodex(ctx, ...)`, and `approve(ctx, ...)` instead of
  `uses: core/...` plugin references inside checked-in flow data.
- Keep bundled core plugins as the implementation seam behind those imported
  callable plugins instead of removing them from the architecture.
- Require plugins, including bundled core plugins, to receive `ctx` as their
  first argument.
- Make imported callable plugins throw on failure. Let flow authors catch and
  handle exceptions in user code when they want recovery behavior.
- Route uncaught handler failures to `onError` when the flow exports that
  handler. Treat flows without `onError` as terminal failure on uncaught
  exceptions.
- Persist one canonical mutable run snapshot per live flow instance.
- Add one explicit durable flow state API on `ctx`. User code must call
  `await ctx.setState(...)` when it wants updated state to survive replay or
  re-entry.
- Keep replay simple: after interruption or process loss, restart the current
  handler from the top using the latest durable snapshot instead of resuming the
  JavaScript stack from the suspension point.
- Do not memoize prior core function results across replay. Replayed handlers
  repeat side effects unless user code prevents duplication through durable
  state.
- Model durable waits as special built-in core functions with dedicated named
  re-entry handlers. `approve(ctx, ...)` re-enters through `onApprove(...)`.
- Keep only one outstanding durable wait per flow instance in `v0.1`.
- Store wait payload data in the run snapshot and pass it to the matching
  re-entry handler when the external event arrives.
- Re-enter waiting flow instances with the latest checked-in flow module rather
  than pinning them to the code revision that created the wait.
- Supersede the YAML flow schema and job state-machine execution model for flows
  migrated to this runtime shape.

## Example Shape

```js
import { approve, defineFlow, run, runCodex } from 'pravaha/flow';

export default defineFlow({
  on: {
    patram: '$class == task and tracked_in == @document and status == ready',
  },

  workspace: 'app',

  async main(ctx) {
    await run(ctx, { command: 'npm ci' });
    await ctx.setState({
      plan_prompt: 'Implement the task.',
    });
    await runCodex(ctx, { prompt: 'Draft a plan.' });
    await approve(ctx, {
      title: 'Approve implementation',
      data: {
        approved_prompt: ctx.state.plan_prompt,
      },
    });
  },

  async onApprove(ctx, data) {
    await runCodex(ctx, { prompt: data.approved_prompt });
  },

  async onError(ctx, error) {
    ctx.console.error(error);
  },
});
```

## Rationale

- Making the JavaScript module the runtime truth removes the impedance mismatch
  between a declarative job graph and the imperative flow shape that authors
  actually want to write.
- Loading the module to discover metadata preserves a single-authoring-surface
  story even though it gives up purely static scheduler discovery.
- Replay-from-top avoids continuation capture, stack serialization, and
  operation-log replay machinery in the runtime.
- Repeating side effects by default keeps Pravaha smaller and clearer about its
  guarantees. Durable deduplication remains possible through explicit state
  writes when a flow actually needs it.
- Dedicated built-in wait functions plus named re-entry handlers keep durable
  suspension simple without designing a generic callback framework too early.
- A single outstanding wait per flow instance preserves the existing
  single-chain ownership model for snapshots, ingress routing, and workspace
  reuse.
- Running latest code on re-entry keeps operations simple at the cost of making
  waiting instances semantically sensitive to checked-in code drift.
- Keeping core plugins behind imported functions preserves one place for
  operator-visible behavior, wait ingress, and runtime-owned integrations even
  when user handlers are otherwise unrestricted Node code.
- Passing `ctx` as the first argument keeps core and non-core plugin invocation
  shapes aligned and makes flow-visible runtime services explicit at each call
  site.
