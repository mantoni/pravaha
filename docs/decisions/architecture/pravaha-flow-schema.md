---
Kind: decision
Id: pravaha-flow-schema
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Pravaha Flow Schema

- Define Pravaha flows as native YAML Patram documents instead of Markdown
  documents with embedded YAML blocks.
- Require each flow document to declare `kind`, `id`, `status`, `scope`, and
  `jobs` at the top level.
- Limit `v0.1` flow composition to one root flow document per contract and keep
  subflow composition out of scope.
- Model each job as a mapping that may declare `select`, `needs`, `if`, and
  `steps`.
- Allow `select` only on jobs and require it to select durable workflow
  documents from exactly one Patram class.
- Auto-bind the selected document inside the job under that selected Patram
  class name such as `task` or `ticket`.
- Reserve `document` as the root flow binding for the contract or other root
  work item that owns the flow instance.
- Model each step as a mapping that may declare `name`, `uses`, `run`, `with`,
  `if`, `await`, `transition`, and `relate`.
- Treat `run` as syntactic sugar for `uses: core/run`.
- Defer multi-way branching constructs such as `switch` and `case` until a later
  version.

## Rationale

- Native YAML keeps machine-shaped flow definitions readable now that Patram can
  index YAML directly.
- A small top-level schema gives Pravaha strict validation without adding a
  second configuration language.
- Restricting `select` to one durable class keeps bindings deterministic and
  aligns job fan-out with task-level leasing semantics.
- Reserving `document` preserves an explicit handle for the flow root while
  allowing repositories to keep their own Patram class names elsewhere.
- Treating `run` as sugar preserves a uniform typed-step model.
- Deferring branching keeps the first implementation focused on the core job and
  step lifecycle.
