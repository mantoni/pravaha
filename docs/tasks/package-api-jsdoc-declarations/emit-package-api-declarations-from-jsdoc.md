---
Kind: task
Id: emit-package-api-declarations-from-jsdoc
Status: done
Tracked in: docs/contracts/workflow/package-api-jsdoc-declarations.md
Implements: docs/contracts/workflow/package-api-jsdoc-declarations.md
Decided by: docs/decisions/workflow/package-api-jsdoc-declarations.md
---

# Emit Package API Declarations From JSDoc

- Add a package declaration build and cleanup flow modeled on `../patram/`.
- Move public flow and plugin contract typing into JSDoc on the owning
  implementation modules.
- Re-export those public types from the package entrypoints through emitted
  declarations.
- Verify that a packed consumer can import and typecheck the generated
  declaration surface.
