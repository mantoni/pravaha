---
Kind: decision
Id: global-workspace-directory-pools
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Global Workspace Directory Pools

- Make `workspace.id` the only flow-authored workspace input. Flows request one
  checked-in workspace namespace and do not declare lifecycle, checkout, or
  placement semantics locally.
- Move the full workspace allocation contract into `pravaha.json` under one
  top-level `workspaces` object keyed by workspace id.
- Let each `workspaces.<id>` entry declare exactly one workspace policy,
  including:
  - lifecycle mode
  - placement policy
  - checkout semantics
- Support two workspace modes:
  - `pooled` uses one fixed ordered `paths` array of reusable directories.
  - `ephemeral` uses one `base_path` directory and derives one concrete
    per-execution subdirectory from the `flow_instance_id`.
- Keep repo-backed checkout semantics explicit in global config. Each workspace
  id declares the repo kind and ref the runtime materializes.
- Treat `pooled` workspaces as limited shared slots:
  - dispatch chooses the first unoccupied configured path
  - cleanup does not delete the directory
  - later runs may reuse the same path
- Treat `ephemeral` workspaces as disposable per-execution directories:
  - runtime derives the concrete path under `base_path`
  - cleanup deletes only that known directory
  - no global scavenging of stale directories
- Persist the concrete selected directory in runtime state and reuse that exact
  path on resume instead of deriving it again from config.
- Treat this as a breaking schema change:
  - old flow-local `workspace.source` and `workspace.materialize` fields are
    invalid
  - old `workspaces.<id>.paths` entries without an explicit `mode` are invalid
  - there is no dual-support migration layer

## Rationale

- Workspace lifecycle and checkout behavior are resource properties, not flow
  properties, so they should live with the workspace namespace rather than be
  split across config and flow documents.
- A flow-only `workspace.id` keeps execution contracts simple and prevents
  config-versus-flow drift.
- `pooled` and `ephemeral` are fundamentally different allocation models and
  should be explicit in global config rather than inferred from flow-local
  materialization fields.
- Resuming from the recorded concrete path avoids accidental reallocation or
  directory drift after interruption.
