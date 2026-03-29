---
Kind: task
Id: remove-knip-reported-dead-code
Status: done
Tracked in: docs/contracts/workflow/static-dead-code-analysis.md
Implements: docs/contracts/workflow/static-dead-code-analysis.md
Decided by: docs/decisions/workflow/static-dead-code-analysis.md
---

# Remove Knip Reported Dead Code

- Remove runtime exports that are only referenced inside their defining module.
- Restore `knip` to a blocking validation check once the runtime export cleanup
  is complete.
- Add a narrow `knip` configuration for repo-local type definition files that
  are consumed through JSDoc imports but still report as unused exported types.

## Notes

- `lib/runtime/dispatch/assignments.js`
- `lib/runtime/dispatch/dispatcher.js`
- `lib/plugin-contract.js`
- `lib/runtime-record-model.js`
- `lib/runtime-fixture-test-helpers.js`
- `lib/core-plugins/types.ts`
- `lib/shared/types/patram-types.ts`
- `lib/shared/types/validation.types.ts`
