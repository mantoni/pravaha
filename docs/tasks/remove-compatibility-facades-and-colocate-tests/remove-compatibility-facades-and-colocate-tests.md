---
Kind: task
Id: remove-compatibility-facades-and-colocate-tests
Status: done
Tracked in: docs/contracts/workflow/remove-compatibility-facades-and-colocate-tests.md
Implements: docs/contracts/workflow/remove-compatibility-facades-and-colocate-tests.md
Decided by: docs/decisions/architecture/remove-compatibility-facades-and-colocate-tests.md
---

# Remove Compatibility Facades And Colocate Tests

- Delete the remaining compatibility-only re-export files.
- Rewrite imports and mocks to use canonical module paths directly.
- Move migrated tests beside the implementation they cover.
- Tighten repo layout assertions so future compatibility shims fail fast.
