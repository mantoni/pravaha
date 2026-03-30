---
Kind: task
Id: hard-cut-raw-patram-trigger-migration
Status: ready
Tracked in: docs/contracts/runtime/local-dispatch-runtime.md
Implements: docs/contracts/runtime/local-dispatch-runtime.md
Decided by:
  - docs/decisions/runtime/raw-patram-trigger-ownership-and-global-flow-matching.md
  - docs/decisions/runtime/flow-instance-rerun-suppression-and-explicit-dispatch.md
---

# Hard Cut Raw Patram Trigger Migration

- Remove `semantic_roles`, `semantic_states`, `root_flow`, `document`, and the
  task-shaped runtime contract in one breaking migration.
- Replace `on.<binding>.where` with `on.patram` and validate one raw Patram
  owner class per dispatchable flow.
- Match configured flows globally against checked-in Patram documents and treat
  multiple matching flows for the same owner document as a local scheduling
  failure for that document only.
- Re-key flow-instance identity and durable rerun suppression on the flow path
  plus owner document id.
- Update built-in flows, fixtures, runtime tests, and public docs to the new
  trigger and ownership model in the same hard cut.
