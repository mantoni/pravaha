---
Kind: task
Id: add-runtime-boundary-source-metadata
Status: done
Tracked in: docs/contracts/workflow/selective-source-metadata.md
Implements: docs/contracts/workflow/selective-source-metadata.md
Decided by: docs/decisions/workflow/selective-source-metadata.md
---

# Add Runtime Boundary Source Metadata

- Annotate only the runtime boundary modules with clear architectural ownership.
- Link those files to their governing decisions and implementation contracts.
- Add an integration test that proves `patram refs` resolves the intended
  reverse references.
- Leave shared helpers unannotated unless they are a primary boundary in their
  own right.

## Applied Boundaries

- `lib/reconcile.js`
- `lib/resume.js`
- `lib/runtime-records.js`
- `lib/runtime-attempt-records.js`
