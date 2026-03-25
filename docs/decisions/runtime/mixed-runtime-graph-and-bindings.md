---
Kind: decision
Id: mixed-runtime-graph-and-bindings
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Mixed Runtime Graph And Bindings

- Expose machine-local runtime state to Pravaha as queryable Patram-style nodes
  in the same logical graph as checked-in workflow documents.
- Reserve the runtime classes `$signal`, `$worker`, `$worktree`, `$lease`, and
  `$flow_instance` for `v0.1`.
- Keep the runtime classes machine-local and transient even though they are
  queryable through the same language as checked-in repository documents.
- Allow `if` and `await` expressions to query across durable workflow documents
  and runtime classes in the mixed graph.
- Limit `jobs.<name>.select` to durable checked-in workflow document classes and
  forbid fan-out directly over runtime classes.
- Bind the flow root as `document` and bind a selected durable document by its
  selected class name.
- Require flow validation to reject ambiguous selections that cannot determine a
  single durable class binding.

## Rationale

- A mixed graph keeps one query language across repository state and local
  runtime state.
- Reserved runtime classes give the engine stable operational semantics without
  leaking them into repository-specific config.
- Forbidding `select` over runtime classes keeps top-level execution anchored to
  durable work items instead of transient events.
- Explicit root and selected bindings make flow expressions readable without
  introducing a second expression language.
