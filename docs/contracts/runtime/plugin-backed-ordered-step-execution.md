---
Kind: contract
Id: plugin-backed-ordered-step-execution
Status: done
Decided by:
  - docs/decisions/runtime/engine-owned-task-leasing.md
  - docs/decisions/runtime/engine-owned-worktree-assignment.md
  - docs/decisions/runtime/ordered-steps-over-worktree-lifecycle-hooks.md
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
  - docs/decisions/runtime/job-and-step-execution-semantics.md
  - docs/decisions/runtime/trigger-driven-codex-runtime.md
Depends on:
  - docs/contracts/runtime/job-level-worktree-policy.md
  - docs/contracts/runtime/ordered-worktree-step-execution.md
  - docs/contracts/runtime/single-flight-scheduler-depth.md
  - docs/contracts/runtime/strict-runtime-resume.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
Root flow: docs/flows/runtime/plugin-backed-ordered-step-execution.md
---

# Plugin-Backed Ordered Step Execution

## Intent

- Keep selected-task jobs as one ordinary ordered step list inside the assigned
  worktree while making `uses` pluggable through checked-in `local/...` and
  installed `npm/...` references.

## Inputs

- The completed job-level worktree policy slice.
- The completed ordered worktree step execution slice.
- The accepted trigger-driven runtime and job execution semantics decisions.
- Root flows that declare plugin-backed `uses`, optional plugin `with` inputs,
  and `await` queries over flow-local emitted runtime signals.

## Outputs

- A public `definePlugin(...)` helper exported from the `pravaha` package.
- Runtime support for loading `local/<name>` plugins from a standard repo-local
  plugin directory that Pravaha may override through checked-in config.
- Runtime support for loading `npm/<name>` plugins from installed package
  entrypoints.
- Runtime support that keeps engine-owned lease acquisition outside the
  plugin-backed `uses` surface.
- Flow validation that checks plugin input contracts, forbids `with` when the
  referenced plugin omits a `with` schema, and restricts `await` to signal kinds
  emitted by plugins referenced in the same flow.
- Runtime support that executes plugin-backed `uses` steps in declared order and
  keeps the assigned worktree in place on first failure.

## Side Effects

- Checked-in flows become the authoritative plugin reference surface through the
  literal `uses` value.
- Repo-local plugin policy may move by changing checked-in Pravaha config rather
  than machine-local runtime state.
- Runtime records may retain flow-local plugin-emitted signal payloads strongly
  enough for the current run to satisfy `await` and transition evaluation.

## Invariants

- `jobs.<name>.worktree` remains limited to engine-owned assignment and reuse
  policy.
- There is no flow-level `prepare`, `cleanup`, or equivalent worktree lifecycle
  hook in this slice.
- Selected-task jobs still execute one declared ordered step list in the
  assigned worktree.
- `local/<name>` and `npm/<name>` are resolved directly from the checked-in
  `uses` value without a second registry mapping layer.
- Engine-owned lease acquisition is not represented as a `uses` plugin.
- Plugins must export `default definePlugin({...})`.
- `with` is optional in the plugin contract and forbidden in the flow when the
  referenced plugin omits it.
- `emits` is required in the plugin contract as a map from signal kind to Zod
  payload schema.
- `await` validation stays flow-local and may reference only signal kinds
  emitted by plugins referenced in the same flow.
- The runtime stops on the first failing ordered step and leaves the worktree
  as-is.

## Failure Modes

- Flow validation accepts plugin modules that do not export the required
  `definePlugin(...)` default contract.
- Plugin-backed `uses` steps rely on a separate registry file or other
  indirection instead of the checked-in `uses` string.
- Engine-owned task leasing or worktree assignment still appears as a fake
  bundled plugin step.
- `with` values fail late at runtime instead of during validation and flow
  interpretation.
- `await` can reference signal kinds that no plugin in the same flow emits.
- Ordered step execution regresses into special worktree lifecycle phases or
  starts cleaning worktrees automatically after failure.

## Review Gate

- Valid `local/<name>` and `npm/<name>` steps load through the checked-in `uses`
  string alone.
- Invalid plugin exports fail clearly during validation or interpretation.
- Plugin `with` inputs are validated against the declared Zod schema.
- Flows reject `with` when the referenced plugin omits a `with` schema.
- Flows reject `await` signal kinds that no referenced plugin in the same flow
  emits.
- Ordered task-step execution still stops on first failure without introducing
  worktree lifecycle hooks.
- Existing non-plugin-backed flows keep working where this slice still intends
  them to.
- `npm run all` passes.
