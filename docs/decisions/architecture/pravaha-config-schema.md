---
Kind: decision
Id: pravaha-config-schema
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Config Schema

- Use one repo-level JSON config file named `.pravaha.json`.
- Limit `v0.1` configuration to two top-level sections: `roles` and `states`.
- Require `roles` to declare:
  - `flow_document_class`
  - `root_work_item_class`
  - `leaseable_unit_class`
  - `dependency_relation`
  - `root_flow_relation`
  - `status_field`
- Require `states` to map semantic state names onto one or more repository
  status values.
- Support the semantic state names `ready`, `active`, `review`, `blocked`,
  `done`, and `dropped` in `v0.1`.
- Keep runtime classes, runtime field names, and built-in step handlers
  hard-coded in the engine instead of exposing them through repo config.
- Validate flows and runtime behavior against `.pravaha.json` as the semantic
  compatibility contract for the repository.

## Rationale

- One small repo-level config keeps the engine kernel explicit without forcing
  repository authors into Pravaha-internal naming.
- Restricting the schema to `roles` and `states` reduces configuration surface
  and leaves engine-owned behavior stable.
- A required `root_flow_relation` matches the one-flow ownership model already
  adopted for contracts.
- A fixed semantic state set gives the scheduler and validators consistent
  meaning for leaseability, review, blocking, and terminal outcomes.
