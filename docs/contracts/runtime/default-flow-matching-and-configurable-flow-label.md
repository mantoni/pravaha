---
Kind: contract
Id: default-flow-matching-and-configurable-flow-label
Status: active
Decided by:
  - docs/decisions/runtime/default-flow-matching-and-configurable-contract-flow-label.md
  - docs/decisions/runtime/config-schema-hard-cut.md
Depends on:
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/contracts/runtime/pravaha-flow-foundation.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/trigger-catalog.md
Root flow: docs/flows/implement-task.js
---

# Default Flow Matching And Configurable Flow Label

## Intent

- Add a fallback dispatch path that resolves one governing flow for a task from
  configured flow glob candidates when the tracked contract omits an explicit
  flow binding.

## Inputs

- The accepted default flow matching and configurable contract flow label
  decision.
- The current contract-scoped dispatch model and root-level flow trigger
  semantics.
- The current Pravaha config surface and Patram metadata mappings.

## Outputs

- Pravaha config support for `flows` as an array of glob expressions.
- Dispatcher fallback resolution that expands candidate flow files with `globby`
  only when the tracked contract has no explicit flow reference.
- Dispatch-time evaluation that keeps `document` bound to the tracked contract
  and reuses each candidate flow's existing `on.<binding>.where` query.
- Dispatch-time ambiguity detection that fails and runs none of the matching
  flows when more than one fallback candidate applies to the same task.
- Validation and fixture coverage for explicit override, zero matches, single
  fallback match, and ambiguous fallback matches.

## Invariants

- Explicit contract flow references remain authoritative.
- Fallback matching does not add task-level explicit flow overrides.
- Config order does not imply precedence across fallback candidates.
- Zero fallback matches leave the task unscheduled.

## Failure Modes

- Fallback flow discovery depends on config order instead of exact match
  cardinality.
- Dispatch silently chooses one fallback flow when more than one candidate
  matches a task.
- Fallback matching introduces a second applicability language outside
  `on.<binding>.where`.

## Review Gate

- Contracts with an explicit flow reference still dispatch through that flow
  even when fallback candidates exist.
- Contracts without an explicit flow reference dispatch successfully when
  exactly one fallback candidate matches a ready task.
- Ambiguous fallback matches fail clearly during dispatch and leave the task
  unscheduled.
- `npm run all` passes.
