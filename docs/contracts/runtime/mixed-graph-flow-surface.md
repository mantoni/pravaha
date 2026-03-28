---
Kind: contract
Id: mixed-graph-flow-surface
Status: done
Decided by:
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/mixed-runtime-graph-and-bindings.md
  - docs/decisions/runtime/codex-sdk-happy-path-backend.md
Depends on:
  - docs/contracts/runtime/strict-runtime-resume.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
  - docs/reference/runtime/pravaha-runtime-architecture.md
  - docs/reference/runtime/runtime-node-model.md
  - docs/reference/runtime/pravaha-flow-examples.md
  - docs/reference/runtime/validation-examples.md
---

# Mixed-Graph Flow Surface

## Intent

- Broaden the executable flow surface so checked-in flows can drive task
  selection, explicit transition targeting, and runtime-aware conditions instead
  of relying on runtime-owned hard-coded selection rules.

## Inputs

- The completed single-task interpreted reconciler.
- The completed strict runtime persistence and manual resume slice.
- One machine-local runtime store that exposes runtime records for the current
  in-flight run.
- One contract with exactly one root flow.
- One supported runtime command surface for `reconcile` and `resume`.

## Outputs

- Flow evaluation that supports query-shaped `select` over durable checked-in
  workflow documents.
- Flow evaluation that supports richer `if` and `await` expressions over the
  mixed graph of durable workflow documents and machine-local runtime nodes.
- Explicit transition targeting in flow steps instead of implicit task-only
  transitions.
- Validation coverage for the widened flow surface.
- Interpreted runtime behavior that is driven by the checked-in root flow rather
  than by hard-coded readiness and target assumptions.

## Side Effects

- Machine-local runtime nodes become queryable by flow conditions.
- Interpreted runs derive more behavior directly from checked-in flow documents.
- Unsupported flow shapes are rejected explicitly instead of being partially
  interpreted.

## Invariants

- `jobs.<name>.select` fans out only over durable checked-in workflow documents.
- Runtime classes remain engine-owned under the protected `$...` namespace.
- The runtime still processes at most one eligible task per invocation.
- Strict unresolved-runtime blocking and exact-task resume semantics remain in
  force.
- Shared workflow mutations remain explicit and auditable.

## Supported Flow Surface

- Support query-shaped `select` for durable workflow document selection.
- Support `if` and `await` evaluation across durable workflow documents and
  reserved runtime classes.
- Support explicit transition targets such as `task` and `document`.
- Keep one contract root flow at a time.
- Keep one selected task processed per reconcile invocation.
- Defer multi-job dependency scheduling depth, multi-task draining, fairness,
  and parallel execution.

## Failure Modes

- Flow documents still act as thin wrappers around hard-coded runtime policy.
- `select` can target runtime classes directly and breaks the durable work-item
  model.
- Mixed-graph conditions are evaluated inconsistently between `if` and `await`.
- Transition targets are applied ambiguously or mutate the wrong checked-in
  document.
- The widened flow language accepts shapes that the runtime cannot execute
  deterministically.

## Review Gate

- Query-shaped `select` is validated and executed over durable checked-in
  workflow documents.
- `if` and `await` can observe reserved runtime nodes through the mixed graph.
- Explicit transition targets are validated and executed correctly.
- Unsupported flow shapes fail clearly in validation or runtime.
- Existing single-task reconcile and strict-resume behavior remain intact.
- `npm run all` passes.
