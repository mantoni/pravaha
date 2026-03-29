---
Kind: decision
Id: remove-compatibility-facades-and-colocate-tests
Status: accepted
Tracked in: docs/plans/repo/v0.1/remove-compatibility-facades-and-colocate-tests.md
---

# Remove Compatibility Facades And Colocate Tests

- Delete compatibility-only modules once their canonical implementation path is
  stable.
- Treat `lib/flow/query.js` and `lib/plugins/plugin-contract.js` as the
  canonical implementation files for the last remaining facade exports.
- Update all internal callers and tests to import canonical implementation
  modules directly instead of routing through compatibility shims.
- Move module tests beside the implementation they exercise so the source tree
  and the test tree communicate the same ownership model.
- Preserve only intentional public entrypoints such as the package root export,
  not migration-era alias files.

## Rationale

- Compatibility facades hide the actual ownership boundary and increase the
  number of valid import paths without adding behavior.
- Colocated tests make the subsystem layout self-describing and keep future
  refactors from reintroducing root-level compatibility drift.
