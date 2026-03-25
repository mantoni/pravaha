---
Kind: decision
Id: flow-documents-and-contract-binding
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Flow Documents And Contract Binding

- Store Pravaha flow definitions as YAML Patram documents.
- Make each contract reference exactly one root flow document through an
  explicit Patram relation.
- Treat the referenced root flow as the sole execution entrypoint for that
  contract in `v0.1`.
- Keep subflow composition and multiple top-level flows out of `v0.1`.
- Shape the flow document language after GitHub Actions while keeping
  Pravaha-specific semantics such as `select`, `needs`, `if`, `await`, `uses`,
  `run`, `transition`, and `relate`.

## Rationale

- One root flow keeps execution ownership, resumption, and debugging local to
  the contract.
- YAML fits machine-shaped flow definitions better than Markdown plus embedded
  structured blocks.
- A GitHub Actions-shaped structure gives users familiar job and step layout
  without constraining Pravaha to GitHub Actions semantics.
- Deferring subflow composition keeps the first implementation focused on one
  execution spine per contract.
