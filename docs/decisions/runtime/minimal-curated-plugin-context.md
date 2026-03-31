---
Kind: decision
Id: minimal-curated-plugin-context
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Minimal Curated Plugin Context

- Keep the stable `v0.1` plugin `context` contract curated and minimal.
- Expose `run_id` as the stable run-scoped idempotency and routing identifier.
- Expose `repo_directory` and `worktree_path` as concrete runtime paths
  available to the current run.
- Expose parsed plugin `with` input.
- Expose the current bound workflow document as `doc`.
- Expose `await context.dispatchFlow({...})` for runtime-native downstream flow
  dispatch.
- Expose a console helper for operator-facing output.
- Do not expose a broad open-ended runtime object or preloaded document content
  in `v0.1`.
- Do not expose a general subprocess or OS execution API on plugin `context`.
- Extend the context later only when a proven plugin use case requires it.

## Rationale

- A curated context keeps the plugin API stable and reviewable.
- Concrete runtime paths such as `worktree_path` let plugins explain local work
  to operators without forcing additional runtime helpers.
- Keeping `dispatchFlow(...)` explicit lets Pravaha preserve durable execution
  semantics for downstream handoff without turning `context` into a broad
  runtime service locator.
- Limiting the contract to explicit fields avoids leaking internal runtime
  structure into the public plugin API too early.
- Holding back preloaded workflow content keeps plugins disciplined: they may
  inspect files when needed without making content-loading a core contract.
