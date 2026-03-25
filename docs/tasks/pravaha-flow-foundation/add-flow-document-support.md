---
Kind: task
Id: add-flow-document-support
Status: done
Tracked in: docs/contracts/runtime/pravaha-flow-foundation.md
Implements: docs/contracts/runtime/pravaha-flow-foundation.md
Decided by: docs/decisions/architecture/flow-documents-and-contract-binding.md
---

# Add Flow Document Support

- Extend the repo workflow model with a `flow` document class.
- Add the explicit contract-to-flow relation needed for one-flow ownership.
- Update Patram config and repo tests to validate the new class and relation.
- Keep the work focused on the checked-in model surface rather than runtime
  execution.
