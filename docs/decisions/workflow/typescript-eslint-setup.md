---
Kind: decision
Id: typescript-eslint-setup
Status: accepted
Tracked in: docs/plans/repo/v0.1/typescript-eslint-setup.md
---

# TypeScript ESLint Setup

- Adopt the `typescript-eslint` flat config pattern already used in
  `../patram/eslint.config.js`.
- Use the same compatible `typescript` major and minor line as `../patram` so
  the ESLint integration remains supported.
- Limit the change to setup only and inspect any resulting lint failures
  separately from this slice.

## Rationale

- Pravaha already carries checked-in `.ts` type files alongside checked JS, so
  the repo benefits from the same type-aware lint integration used in the
  sibling package.
- Separating setup from rule-fix follow-up keeps the review surface small and
  makes the new lint output easier to inspect.
