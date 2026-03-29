---
Kind: decision
Id: typescript-eslint-remediation
Status: accepted
Tracked in: docs/plans/repo/v0.1/typescript-eslint-remediation.md
---

# TypeScript ESLint Remediation

- Fix the `typescript-eslint` violations surfaced by the setup slice in source,
  tests, scripts, and type declarations.
- Prefer source changes that make types and async intent explicit over weakening
  rules or suppressing diagnostics.
- Preserve current runtime behavior while aligning naming and error-handling
  surfaces with the repo's conventions.

## Rationale

- The setup slice intentionally stopped before changing source files, so the
  repo now needs one focused remediation pass to restore the validation gate.
- Type-aware lint rules are only useful if the checked-in code satisfies them
  without relying on broad ignore comments.
