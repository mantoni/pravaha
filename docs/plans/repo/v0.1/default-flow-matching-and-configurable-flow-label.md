---
Kind: plan
Id: default-flow-matching-and-configurable-flow-label
Status: active
Depends on:
  - docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
  - docs/decisions/runtime/default-flow-matching-and-configurable-contract-flow-label.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/trigger-catalog.md
---

# Default Flow Matching And Configurable Flow Label Plan

## Goal

- Let contracts omit an explicit flow reference when one fallback flow can be
  resolved unambiguously at dispatch time.
- Allow repositories to rename the user-facing contract flow label without
  renaming the internal Patram relation.

## Scope

- Extend Pravaha config with a `flows` section containing `default_matches` and
  `root_flow_label`.
- Expand fallback flow candidates from glob expressions with `globby`.
- Keep explicit contract flow references authoritative and use fallback matching
  only when the contract omits the explicit binding.
- Resolve fallback candidates through each flow's existing `on.<binding>.where`
  query in contract scope.
- Surface a dispatch-time error when more than one fallback flow matches the
  same task.
- Update Patram-facing metadata parsing so the configured user-facing label maps
  back onto the stable internal `root_flow` relation.

## Acceptance

- Contracts may omit an explicit flow reference and still schedule work when
  exactly one fallback flow matches a ready task.
- Explicit contract flow references continue to override fallback config.
- The configured `flows.root_flow_label` changes only the user-facing contract
  metadata label.
- Ambiguous fallback matches fail clearly during dispatch and schedule no work
  for the task.
- `npm run all` passes.
