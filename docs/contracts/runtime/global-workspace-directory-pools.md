---
Kind: contract
Id: global-workspace-directory-pools
Status: active
Decided by:
  - docs/decisions/runtime/global-workspace-directory-pools.md
Depends on:
  - docs/contracts/runtime/multi-slot-pooled-workspaces.md
  - docs/contracts/runtime/job-state-machine-execution.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Global Workspace Directory Pools

## Intent

- Move sharable workspace location pools into global config while keeping
  flow-authored workspace semantics explicit.

## Inputs

- The accepted global workspace directory pools decision.
- Existing state-machine flows that currently declare workspace ids or pooled
  workspace source ids in flow documents.
- Dispatch runtime logic that already treats worktree or checkout directories as
  exclusive resources per unresolved run.

## Outputs

- `pravaha.json` validation that accepts a top-level `workspaces` object keyed
  by workspace id.
- Workspace config validation that accepts one non-empty ordered unique `paths`
  array per workspace id.
- Flow validation that accepts `workspace.id` and rejects flow-local
  `workspace.source.id` and `workspace.source.ids`.
- Flow interpretation that preserves flow-authored `source` and `materialize`
  semantics while carrying one referenced workspace id.
- Dispatch behavior that resolves the referenced workspace id to one ordered
  pool of configured directory paths and chooses the first unoccupied path.
- Startup warnings for flows that share one workspace id but disagree on
  semantics.
- Assignment behavior that refuses execution for flows whose shared workspace id
  is semantically conflicted.
- Runtime records that persist one concrete selected directory for unresolved
  and final runs.
- Resume behavior that reuses the recorded directory exactly.

## Side Effects

- Operators manage shared workspace capacity by editing global config rather
  than by editing each flow.
- A single conflicting workspace id may disable execution for multiple flows
  that reference it.
- Flow portability now depends on the target repo config defining the requested
  workspace id.

## Invariants

- Flow-authored `workspace` blocks describe what the runtime materializes, not
  where it lives.
- Global config owns the allowed concrete directories for a workspace id.
- Every flow that references the same workspace id declares identical workspace
  semantics.
- Startup warns for semantic conflicts but does not abort the runtime.
- Execution warns again and refuses any flow whose workspace id is in semantic
  conflict.
- Dispatch selects at most one concrete directory per flow instance.
- Resume never re-selects a directory for an unresolved run.

## Validation Rules

- Accept top-level `workspaces.<id>.paths` as an array of unique non-empty
  strings.
- Reject missing, empty, or duplicate path entries.
- Accept flow-level `workspace.id` as one non-empty string.
- Reject flow-level `workspace.source.id` and `workspace.source.ids`.
- Reject flows that reference a workspace id that is not defined in config.
- Report semantic conflicts across flows that reference the same workspace id.

## Runtime Rules

- Resolve each flow workspace id to the configured ordered directory pool.
- Normalize relative configured paths against the repo directory before
  occupancy checks and materialization.
- Exclude already occupied directories during assignment selection.
- Reserve the selected directory during assignment materialization so one
  dispatch pass does not double-book it.
- Materialize the concrete selected directory before the first job visit.
- Persist the selected directory into runtime state for unresolved and final
  outcomes.
- Rebuild resume context from the recorded directory rather than by selecting a
  fresh directory from config.

## Failure Modes

- Flows silently diverge on workspace semantics while sharing one workspace id.
- Dispatch executes a flow even though its workspace id is semantically
  conflicted.
- Config declares ambiguous or duplicate workspace directory pools.
- Resume switches to a different configured directory after interruption.
- Dispatch double-books one configured directory in the same pass.

## Review Gate

- Valid repos load global workspace path pools from `pravaha.json`.
- Valid flows load with `workspace.id` plus explicit `source` and `materialize`
  semantics.
- Invalid flows that still use flow-local `workspace.source.id` or
  `workspace.source.ids` fail clearly.
- Semantic conflicts across flows sharing one workspace id warn during load and
  prevent execution.
- Dispatch skips occupied earlier paths and chooses a later free configured
  directory.
- Resume reuses the recorded directory exactly.
- `npm run all` passes.
