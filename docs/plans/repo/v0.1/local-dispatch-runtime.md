---
Kind: plan
Id: local-dispatch-runtime
Status: active
Depends on:
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/decisions/runtime/dispatcher-owned-local-worker-pool.md
  - docs/decisions/runtime/automatic-follower-failover.md
  - docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/trigger-catalog.md
---

# Local Dispatch Runtime Plan

## Goal

- Evolve Pravaha from the current single-run reconciler into an operator-driven
  local worker pool with dispatcher-owned scheduling and explicit wake-up
  dispatch.

## Scope

- Add a root-level `on` trigger surface for dispatchable flows.
- Replace job-level durable fan-out with one bound flow instance per matched
  trigger document.
- Add `pravaha worker` and `pravaha dispatch` CLI commands.
- Add ad hoc `pravaha dispatch --file` and `pravaha dispatch --prompt`
  entrypoints with checked-in flow trigger declarations.
- Add a portable local IPC endpoint abstraction and a minimal internal protocol
  for worker registration, notify, assignment, completion, and failure.
- Add dispatcher leadership acquisition, follower registration, takeover, and
  rescan behavior.
- Replace single-flight scheduling with dispatcher-owned pending instance
  discovery and assignment across connected workers.
- Adapt runtime persistence, worktree ownership, and observability to
  multi-worker execution.
- Migrate representative runtime fixtures and example flows to the `on` surface.

## Acceptance

- Dispatchable flows validate with `on.<binding>.where` and expose the trigger
  binding to job steps.
- `pravaha worker` can start multiple local workers with one elected dispatcher.
- `pravaha dispatch` can wake the active dispatcher and return success even when
  no dispatcher is alive.
- `pravaha dispatch --file <repo-path>` and `pravaha dispatch --prompt <text>`
  create one-off durable runs only when exactly one eligible flow matches.
- The dispatcher rescans authoritative state on startup and takeover and
  rediscovers unfinished flow instances safely.
- Connected followers remain in the worker pool across dispatcher loss and one
  of them can take over leadership automatically.
- Connected workers receive concrete assignments from the dispatcher instead of
  running the old local select loop themselves.
- Worktree and runtime state remain queryable and do not allow duplicate active
  ownership of the same durable flow instance.
- Breaking change. No backward compatibility required.

## Sequencing

- Phase 1: Flow surface
  - Add the root-level `on` schema and validation rules.
  - Bind the trigger document into the interpreted flow instance.
  - Add `on.file` and `on.prompt` for explicit ad hoc dispatch eligibility.
- Phase 2: Runtime entrypoints
  - Add `pravaha worker` and `pravaha dispatch`.
  - Add explicit ad hoc dispatch resolution for file and prompt input.
  - Add the endpoint abstraction and the newline-delimited internal protocol.
  - Add leadership acquisition, follower registration, and notify handling.
- Phase 3: Dispatcher scheduling
  - Materialize pending flow instances from authoritative state.
  - Track ready workers and assign one flow instance at a time.
  - Record enough machine-local runtime state to recover after worker or
    dispatcher loss.
- Phase 4: Migration and hardening
  - Migrate sample flows and fixtures to the `on` model.
  - Tighten worker-facing observability around assignment identity, leadership,
    and takeover.
  - Revisit restart and resume semantics under the long-running worker pool.
