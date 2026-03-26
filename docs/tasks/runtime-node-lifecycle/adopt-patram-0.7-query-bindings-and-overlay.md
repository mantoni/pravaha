---
Kind: task
Id: adopt-patram-0.7-query-bindings-and-overlay
Status: done
Tracked in: docs/contracts/runtime/runtime-node-lifecycle.md
Implements: docs/contracts/runtime/runtime-node-lifecycle.md
Decided by:
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
  - docs/decisions/workflow/patram-0.7-upgrade.md
---

# Adopt Patram 0.7 Query Bindings And Overlay

- Replace Pravaha's local query binding rewrite with Patram `0.7.0` query
  bindings and adopt `@binding_name` notation in executable flow queries.
- Migrate query contexts that refer to bound workflow documents from bare
  binding names such as `document` and `task` to `@document` and `@task`.
- Keep literal field values and flow keywords unchanged, such as
  `subject == task` and transition targets like `task` and `document`.
- Replace local Patram compatibility shims and manual mixed-graph composition
  with Patram's public types and graph overlay support where it preserves the
  current runtime semantics.
- Preserve reconcile, resume, runtime-node lifecycle, and worktree-policy
  behavior while adding regression coverage for the new binding syntax and graph
  integration surface.
