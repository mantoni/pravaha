---
Kind: decision
Id: semantic-role-config-and-state-model
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Semantic Role Config And State Model

- Add one repo-level Pravaha JSON config file to map semantic roles and semantic
  states onto the repository's Patram model.
- Keep runtime classes and built-in step handlers fixed in the engine instead of
  making them user-configurable.
- Reserve Pravaha runtime classes under a protected `$...` namespace such as
  `$signal`, `$worker`, `$worktree`, `$lease`, and `$flow_instance`.
- Require strict validation of flow documents against the configured semantic
  role and state model.
- Tie leaseability to configured semantic `ready` states.

## Rationale

- Explicit role and state mapping gives Pravaha a small fixed kernel while still
  allowing repositories to keep their own Patram vocabulary.
- Fixed runtime classes avoid brittle per-repo overrides for core engine
  semantics.
- A protected runtime namespace prevents collisions between checked-in Patram
  documents and machine-local runtime nodes.
- Semantic state mapping gives the scheduler and validators predictable meaning
  for readiness, review, blocking, and terminal states.
