---
Kind: task
Id: add-javascript-flow-module-loading-and-validation
Status: ready
Tracked in: docs/contracts/runtime/javascript-flow-module-runtime.md
Implements: docs/contracts/runtime/javascript-flow-module-runtime.md
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
---

# Add JavaScript Flow Module Loading And Validation

- Add runtime loading for root flow assets that export
  `default defineFlow({...})` as ECMAScript modules.
- Validate flow metadata, require `main`, allow named re-entry handlers, and
  reject migrated flows that still rely on legacy YAML graph fields.
- Define how checked-in root flow references resolve JavaScript flow assets in
  repository metadata and runtime lookup.
- Keep trigger and workspace declarations in loaded flow metadata even though
  the runtime no longer requires static extraction.
