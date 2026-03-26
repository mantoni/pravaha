---
Kind: task
Id: clarify-current-run-snapshot-retention
Status: done
Tracked in: docs/contracts/runtime/runtime-node-lifecycle.md
Implements: docs/contracts/runtime/runtime-node-lifecycle.md
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
---

# Clarify Current Run Snapshot Retention

- Tighten the retained terminal runtime-node contract so `$flow_instance` and
  terminal `$signal` state mean only the current matching run snapshot.
- Preserve active-node visibility for unresolved runs and keep unresolved
  runtime blocking and strict resume behavior unchanged.
- Allow a later matching terminal run to replace an older retained snapshot only
  when the current run is unambiguous.
- Fail closed when multiple retained matches would expose ambiguous local
  runtime history to the flow.
- Do not add operator-facing inspection or cleanup tooling in this slice.
