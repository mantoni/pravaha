---
Kind: decision
Id: static-dead-code-analysis
Status: accepted
Tracked in: docs/plans/repo/v0.1/static-dead-code-analysis.md
---

# Static Dead Code Analysis

- Add `knip` as the repo's static dead-code analysis tool.
- Expose `knip` through a dedicated package check script and include it in the
  main validation path.
- Split dead-code analysis into two repo checks with different boundaries:
  `npm run check:knip:production` for the published runtime tree and
  `npm run check:knip` for the full repository including tests.
- Keep test-only fixtures, harnesses, and support modules outside the published
  `lib/` and `bin/` implementation tree.
- Treat `knip` findings as review input for follow-up cleanup rather than
  removing reported code opportunistically during tool installation.

## Rationale

- Pravaha already validates formatting, linting, types, workflow docs, tests,
  and duplicate code, but it does not currently scan for unused files, exports,
  and dependencies.
- Installing `knip` adds a deterministic static signal for dead-code review
  without changing runtime behavior.
- The production pass should only judge the publishable runtime surface.
  Otherwise test-only fixtures inside `lib/` look like dead production exports
  even when they are still actively used by tests.
- The full-repo pass should continue to see test support so dead fixtures and
  unused harness exports fail like any other repository-local dead code.
- Separating installation from cleanup keeps each follow-up change narrow and
  makes each reported finding easier to review on its own merits.
