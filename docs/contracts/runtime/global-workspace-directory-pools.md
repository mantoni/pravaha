---
Kind: contract
Id: global-workspace-directory-pools
Status: active
Decided by:
  - docs/decisions/runtime/global-workspace-directory-pools.md
Depends on:
  - docs/contracts/runtime/multi-slot-pooled-workspaces.md
  - docs/contracts/runtime/javascript-flow-module-runtime.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Global Workspace Directory Pools

## Intent

- Make global workspace config own lifecycle, placement, and checkout semantics
  while flows request only one workspace namespace by id.

## Inputs

- The accepted global workspace directory pools decision.
- Existing JavaScript flow modules that currently declare `workspace`.
- Dispatch runtime logic that already tracks occupied concrete directories per
  unresolved run.

## Outputs

- `pravaha.config.js` validation that accepts a top-level `workspaces` object
  keyed by workspace id.
- Workspace config validation that accepts one tagged workspace definition per
  id:
  - `mode: pooled` plus one ordered unique non-empty `paths` array
  - `mode: ephemeral` plus one non-empty `base_path`
  - explicit repo-backed checkout semantics such as source kind and ref
- Flow validation that accepts only `workspace`.
- Flow interpretation that resolves one referenced global workspace id instead
  of preserving flow-local `source` or `materialize` fields.
- Dispatch behavior that resolves the referenced workspace id to one concrete
  runtime allocation according to the workspace mode.
- Runtime records that persist one concrete selected directory for unresolved
  and final runs.
- Resume behavior that reuses the recorded directory exactly.

## Side Effects

- Operators manage workspace lifecycle and capacity centrally in config rather
  than by editing individual flows.
- Flow portability depends on the target repo config defining the requested
  workspace id.
- Changing one workspace id now changes runtime behavior for every flow that
  references it.

## Invariants

- Flow-authored `workspace` values are one workspace id string.
- Global config owns the lifecycle mode, placement policy, and checkout
  semantics for a workspace id.
- Every referenced workspace id must exist in `pravaha.config.js`.
- `pooled` uses only configured fixed paths and never auto-deletes them.
- `ephemeral` derives one concrete directory under `base_path` from the
  `flow_instance_id` and deletes only that known directory during cleanup.
- Resume never re-selects a directory for an unresolved run.

## Validation Rules

- Accept top-level `workspaces.<id>.mode` as either `pooled` or `ephemeral`.
- Accept `workspaces.<id>.paths` only for `pooled` workspaces.
- Accept `workspaces.<id>.base_path` only for `ephemeral` workspaces.
- Reject missing, empty, or duplicate pooled path entries.
- Reject empty ephemeral base paths.
- Reject workspace definitions that mix `paths` and `base_path`.
- Reject workspace definitions that omit required repo-backed checkout fields.
- Accept flow-level `workspace` as one non-empty string.
- Reject flows that reference a workspace id that is not defined in config.

## Runtime Rules

- Resolve each flow workspace id to the configured global workspace definition.
- Normalize relative configured paths against the repo directory before
  occupancy checks and materialization.
- For `pooled`, exclude already occupied configured paths during assignment
  selection and choose the first free slot.
- For `ephemeral`, derive the concrete directory from `base_path` and the
  `flow_instance_id` rather than from a fixed configured slot.
- Materialize the concrete selected directory before the first job visit.
- Persist the selected directory into runtime state for unresolved and final
  outcomes.
- Rebuild resume context from the recorded directory rather than by selecting a
  fresh directory from config.

## Failure Modes

- Flows continue to declare legacy flow-local workspace semantics after the
  schema break.
- Config declares an invalid workspace mode or mixes pooled and ephemeral
  placement fields.
- Dispatch reuses a pooled slot that is already occupied.
- Ephemeral allocation incorrectly reuses one shared fixed slot.
- Resume switches to a different configured directory after interruption.

## Review Gate

- Valid repos load pooled and ephemeral global workspace definitions from
  `pravaha.config.js`.
- Valid flows load with `workspace` only.
- Invalid flows that still use flow-local workspace semantics fail clearly.
- Dispatch skips occupied earlier pooled paths and chooses a later free
  configured directory.
- Ephemeral allocation derives the concrete path from `base_path` and the flow
  instance id.
- Resume reuses the recorded directory exactly.
- `npm run all` passes.
