---
Kind: decision
Id: ad-hoc-dispatch-input-triggers
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Ad Hoc Dispatch Input Triggers

- Keep `pravaha dispatch [path]` as the best-effort dispatcher wake-up
  entrypoint and keep `pravaha dispatch --flow <flow_instance_id> [path]` as the
  explicit rerun override for an existing durable flow instance.
- Add two ad hoc dispatch entrypoints for new one-off runs:
  - `pravaha dispatch --file <repo-path> [path]`
  - `pravaha dispatch --prompt <text> [path]`
- Treat ad hoc dispatch as a fresh durable run with a new flow-instance id
  rather than rebinding an existing scheduler-visible durable match.
- Extend the flow root `on` map with:
  - `on.file` as a `globby` expression that opts a flow into file-backed ad hoc
    dispatch.
  - `on.prompt` as a boolean that opts a flow into prompt-backed ad hoc
    dispatch.
- Resolve `--file` against checked-in flow candidates by exact match
  cardinality:
  - A flow is eligible when the supplied repo path matches `on.file`.
  - When more than one eligible flow matches, fail and dispatch none.
  - When the selected flow also defines `on.patram`, the supplied file must
    match that Patram query when projected as the bound document; otherwise fail
    with a warning.
- Resolve `--prompt` against checked-in flow candidates by exact match
  cardinality:
  - A flow is eligible only when `on.prompt` is `true`.
  - Flows that define `on.patram` must reject prompt dispatch.
  - When more than one eligible flow matches, fail and dispatch none.
- Bind a file-backed ad hoc run through the normal `doc` binding so the supplied
  file becomes the flow input in the same shape as a Patram-backed document
  binding.
- Surface prompt-backed ad hoc input explicitly on the flow context instead of
  fabricating a durable Patram document.

## Rationale

- A fresh ad hoc run preserves the current scheduler model for durable Patram
  matches while still giving operators a direct one-off execution path.
- Explicit `on.file` and `on.prompt` declarations keep manual entrypoints
  visible in checked-in flow definitions instead of relying on repo-global
  conventions or implicit fallback behavior.
- Exact match cardinality avoids hidden precedence between ad hoc flow
  candidates and keeps manual dispatch failure modes obvious.
