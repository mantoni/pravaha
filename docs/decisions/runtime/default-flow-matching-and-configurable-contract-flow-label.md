---
Kind: decision
Id: default-flow-matching-and-configurable-contract-flow-label
Status: accepted
Tracked in: docs/plans/repo/v0.1/default-flow-matching-and-configurable-flow-label.md
---

# Default Flow Matching And Configurable Contract Flow Label

- Keep the internal Patram relation name for explicit contract flow binding as
  `root_flow`.
- Allow the user-facing contract front matter label for that relation to be
  configured through the Pravaha config as `flows.root_flow_label`.
- Default the user-facing label to `Root flow` when the config omits it.
- Add one optional Pravaha config section `flows` with
  `default_matches: string[]` for glob-based default flow discovery.
- Expand `flows.default_matches` with `globby` and treat the resulting flow
  files as an unordered candidate set.
- Use default flow matching only when the tracked contract has no explicit flow
  reference.
- Keep flow applicability rooted in each candidate flow's existing
  `on.<binding>.where` query with `document` bound to the tracked contract.
- Keep matching contract-scoped and do not add task-level explicit flow
  overrides in this slice.
- Allow a task to resolve to exactly one governing flow.
- If more than one default candidate flow matches the same task at dispatch
  time, fail that scheduling attempt and run none of the matching flows.
- If no default candidate flow matches a task, leave the task unscheduled.
- Keep explicit contract flow references authoritative over `flows` fallback
  matching.

## Rationale

- Keeping `root_flow` stable internally avoids widening the Patram relation and
  dispatcher surface for a user-facing label change alone.
- Treating `default_matches` as a fallback preserves the current explicit
  contract-owned flow model while reducing boilerplate for common cases.
- Reusing `on.<binding>.where` keeps one source of truth for flow applicability
  instead of introducing a second matching language in config.
- Runtime ambiguity failure is narrow enough to protect operators without
  rejecting repositories that merely contain overlapping fallback candidates.
