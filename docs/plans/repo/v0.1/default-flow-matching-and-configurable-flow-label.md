---
Kind: plan
Id: default-flow-matching-and-configurable-flow-label
Status: active
Depends on:
  - docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
  - docs/decisions/runtime/default-flow-matching-and-configurable-contract-flow-label.md
  - docs/decisions/runtime/config-schema-hard-cut.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/trigger-catalog.md
---

# Default Flow Matching And Configurable Flow Label Plan

## Goal

- Let contracts omit an explicit flow reference when one fallback flow can be
  resolved unambiguously at dispatch time.

## Scope

- Extend Pravaha config with a `flows` array.
- Expand fallback flow candidates from glob expressions with `globby`.
- Keep explicit contract flow references authoritative and use fallback matching
  only when the contract omits the explicit binding.
- Resolve fallback candidates through each flow's existing `on.<binding>.where`
  query in contract scope.
- Surface a dispatch-time error when more than one fallback flow matches the
  same task.

## Acceptance

- Contracts may omit an explicit flow reference and still schedule work when
  exactly one fallback flow matches a ready task.
- Explicit contract flow references continue to override fallback config.
- Ambiguous fallback matches fail clearly during dispatch and schedule no work
  for the task.
- `npm run all` passes.
