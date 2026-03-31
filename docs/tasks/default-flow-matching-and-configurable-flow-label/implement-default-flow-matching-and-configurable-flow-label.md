---
Kind: task
Id: implement-default-flow-matching-and-configurable-flow-label
Status: done
Tracked in: docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
Implements: docs/contracts/runtime/default-flow-matching-and-configurable-flow-label.md
Decided by:
  - docs/decisions/runtime/default-flow-matching-and-configurable-contract-flow-label.md
---

# Implement Default Flow Matching And Configurable Flow Label

- Extend the Pravaha config parser and validation to accept:

```json
{
  "flows": {
    "default_matches": ["docs/flows/**/*.js"],
    "root_flow_label": "Root flow"
  }
}
```

- Keep `flows.default_matches` optional and interpret it as an unordered list of
  glob expressions expanded with `globby`.
- Keep `flows.root_flow_label` optional and default it to `Root flow`.
- Preserve the internal Patram relation name `root_flow` while making contract
  metadata parsing accept the configured `flows.root_flow_label`.
- Update the dispatcher so contracts without an explicit flow reference resolve
  fallback flow candidates from `flows.default_matches`.
- Evaluate each fallback candidate through its existing `on.<binding>.where`
  query in contract scope with `document` bound to the tracked contract.
- When more than one fallback candidate matches the same task at dispatch time,
  surface a clear runtime error and schedule none of the matching flows.
- Keep explicit contract flow references authoritative over fallback config.
- Update config fixtures, runtime fixtures, Patram mapping coverage, docs, and
  tests for explicit override, zero matches, one fallback match, and ambiguous
  fallback matches.
