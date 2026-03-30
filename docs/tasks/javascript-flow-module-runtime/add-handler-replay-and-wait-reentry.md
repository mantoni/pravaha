---
Kind: task
Id: add-handler-replay-and-wait-reentry
Status: done
Tracked in: docs/contracts/runtime/javascript-flow-module-runtime.md
Depends on:
  - docs/tasks/javascript-flow-module-runtime/add-flow-context-and-imported-built-ins.md
Implements: docs/contracts/runtime/javascript-flow-module-runtime.md
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
  - docs/decisions/runtime/current-truth-run-snapshot-persistence.md
---

# Add Handler Replay And Wait Re-Entry

- Replace ordered-step resume for migrated flows with replay-from-top execution
  of the current handler using the latest durable snapshot.
- Persist durable flow state only through `await ctx.setState(...)` and make
  in-memory handler state non-durable by default.
- Persist one outstanding wait plus wait payload data in the canonical run
  snapshot.
- Re-enter approval waits through `onApprove(ctx, data)` under the latest
  checked-in module and route uncaught failures through `onError(ctx, error)`
  when exported.
- Keep repeated side effects on replay as an explicit runtime guarantee instead
  of adding built-in result memoization.
