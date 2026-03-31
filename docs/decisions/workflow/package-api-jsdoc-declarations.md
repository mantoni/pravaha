---
Kind: decision
Id: package-api-jsdoc-declarations
Status: accepted
Tracked in: docs/plans/repo/v0.1/package-api-jsdoc-declarations.md
---

# Package API JSDoc Declarations

- Generate publish-time declaration files from source JSDoc during npm pack and
  publish.
- Keep package entrypoint type surfaces rooted in emitted declarations under
  `lib/` rather than hand-maintained package-root `.d.ts` files.
- Move public flow and plugin contract typing into the implementation modules
  that define those contracts where JSDoc can express the type surface.
- Rewrite emitted `.ts` type specifiers to `.d.ts` so consumers under
  `moduleResolution: "NodeNext"` can resolve the packaged declarations without
  `allowImportingTsExtensions`.

## Rationale

- Public API typing that lives next to implementation reduces drift between
  runtime behavior and published types.
- Build-time declaration emit keeps generated artifacts out of normal
  development while still shipping a complete npm type surface.
- Rewriting repo-only `.ts` specifiers avoids exposing source-only typing
  mechanics to consumers.
