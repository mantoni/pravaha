---
Kind: task
Id: remove-yaml-flow-definition-support
Status: active
Tracked in: docs/contracts/runtime/javascript-flow-module-runtime.md
Implements: docs/contracts/runtime/javascript-flow-module-runtime.md
Decided by:
  - docs/decisions/runtime/javascript-flow-modules-as-runtime-truth.md
---

# Remove YAML Flow Definition Support

- Stop treating checked-in YAML files as supported flow definitions for
  validation, discovery, and dispatch.
- Require flow assets under `docs/flows/` and flow references in runtime config
  to resolve to JavaScript modules that export `default defineFlow({...})`.
- Update queue validation flow loading and adjacent repo validation helpers to
  use the JavaScript flow surface.
- Remove public-facing YAML flow examples and compatibility expectations from
  tests and runtime diagnostics.
