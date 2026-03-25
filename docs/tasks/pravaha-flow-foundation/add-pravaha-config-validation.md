---
Kind: task
Id: add-pravaha-config-validation
Status: done
Tracked in: docs/contracts/runtime/pravaha-flow-foundation.md
Implements: docs/contracts/runtime/pravaha-flow-foundation.md
Decided by: docs/decisions/architecture/semantic-role-config-and-state-model.md
Depends on: docs/tasks/pravaha-flow-foundation/add-flow-document-support.md
---

# Add Pravaha Config Validation

- Add the repo-level Pravaha JSON config for semantic roles and semantic states.
- Validate flow documents against the configured semantic role and state model.
- Keep runtime classes and built-in step handlers hard-coded in the engine.
