---
Kind: decision
Id: north-star-statement
Status: accepted
Tracked in: docs/plans/repo/v0.1/north-star.md
---

# North Star Statement

- Use
  `Pravaha turns human workflow into explicit contracts that agents can execute.`
  as the primary project description.
- Define Pravaha as a workflow automation engine built on top of `patram`.
- Keep humans responsible for intent, decisions, constraints, and review.
- Keep agents responsible for implementation and integration.
- Treat inputs, outputs, side effects, invariants, failure modes, and review
  gates as the contract agents execute against.
- Keep the product centered on a small set of primitives instead of enforcing a
  single workflow.

## Rationale

- The statement is short enough for package metadata and strong enough to act as
  a north-star.
- The supporting definition keeps the project from collapsing into generic
  automation language.
- Explicit contracts are the stable surface that lets implementations evolve
  without losing control or reviewability.
