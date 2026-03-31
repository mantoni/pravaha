---
Kind: decision
Id: flow-documents-and-contract-binding
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Flow Documents And Contract Binding

- Store Pravaha flow definitions as JavaScript modules that default-export
  `defineFlow({...})`.
- Make each contract reference exactly one root flow document through an
  explicit Patram relation.
- Treat the referenced root flow as the sole execution entrypoint for that
  contract in `v0.1`.
- Keep subflow composition and multiple top-level flows out of `v0.1`.
- Keep one root flow module per contract and let executable handlers own control
  flow instead of an engine-owned graph language.

## Rationale

- One root flow keeps execution ownership, resumption, and debugging local to
  the contract.
- One root flow module keeps execution ownership, resumption, and debugging
  local to the contract without preserving a second checked-in graph surface.
- Deferring subflow composition keeps the first implementation focused on one
  execution spine per contract.
