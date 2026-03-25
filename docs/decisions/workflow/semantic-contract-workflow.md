---
Kind: decision
Id: semantic-contract-workflow
Status: accepted
Tracked in: docs/plans/repo/v0.1/semantic-contract-workflow.md
---

# Semantic Contract Workflow

- Make semantic contracts the primary workflow object in this repository.
- Use front matter metadata to define workflow identity and state.
- Map `Kind` to the canonical Patram class and `Id` to the canonical semantic
  id.
- Keep review gates inside contract documents instead of creating a separate
  review document class for now.
- Use directory placement rules to validate where each semantic class lives, but
  use semantic ids and graph relations as the source of truth.
- Keep repo implementation plans in `docs/plans/repo/v<major>.<minor>/` for
  evolving Pravaha itself.

## Rationale

- Pravaha's north star is contract execution, not folder choreography.
- Patram `0.4.0` can now promote document-backed nodes to canonical semantic
  identities and can express grouped boolean workflow queries.
- Stable semantic ids let agents navigate by meaning such as
  `contract:semantic-contract-workflow` rather than by path alone.
- Front matter keeps workflow metadata explicit while avoiding the visible
  directive parsing noise that still exists in free-form prose.
