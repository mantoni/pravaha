---
Kind: plan
Id: semantic-contract-workflow
Status: active
---

# Semantic Contract Workflow Plan

## Goal

- Replace the old document-only Patram model with a semantic contract workflow.
- Update agent guidance, repository structure guidance, and Patram config to use
  semantic classes, stable ids, and grouped workflow queries.

## Scope

- Add the workflow decision and metadata convention.
- Update `.patram.json` to the Patram `0.4.0` schema.
- Update `AGENTS.md` with the contract-centric workflow.
- Update `docs/conventions/repository/docs-structure.md` to describe the
  semantic document layout.
- Add tests that verify every stored Patram query against a representative
  workflow fixture.

## Acceptance

- `patram check` passes with the new config.
- `npx patram queries` lists the semantic workflow queries.
- `AGENTS.md` tells agents to start from contracts and query the workflow graph
  by semantic id.
- `docs/conventions/repository/docs-structure.md` describes contracts, tasks,
  decisions, conventions, references, and repo plans distinctly.
- Tests cover every stored query and confirm each query returns the expected
  semantic ids.
