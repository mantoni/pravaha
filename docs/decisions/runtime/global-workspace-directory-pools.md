---
Kind: decision
Id: global-workspace-directory-pools
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Global Workspace Directory Pools

- Move sharable workspace location setup from flow-local `workspace.source.id`
  and `workspace.source.ids` into checked-in `pravaha.json` config under a
  top-level `workspaces` object keyed by workspace id.
- Let each `workspaces.<id>` entry declare one ordered pool of allowed directory
  paths where a matching flow may materialize a checkout or worktree.
- Keep flow-level `workspace` blocks responsible for workspace semantics rather
  than location. Flows declare the workspace id they require plus the checked-in
  `source` and `materialize` contract that describes what the runtime should
  create in one selected directory.
- Require every flow that references the same workspace id to declare identical
  workspace semantics.
- Treat semantic mismatches for one shared workspace id as a warning during
  startup or load rather than a fatal boot error.
- Refuse execution for any flow that references a semantically conflicting
  workspace id and warn again on each attempted execution.
- Treat each configured workspace directory as one non-sharable runtime
  resource. Dispatch selects the first unoccupied allowed directory in
  declaration order.
- Persist the concrete selected directory in runtime state and reuse that exact
  directory on resume instead of selecting again.

## Rationale

- Workspace locations are operator-owned environment setup and should be shared
  across flows rather than copied into each flow document.
- Flow authors still need to make the materialization semantics explicit so the
  checked-in contract says what kind of working copy will exist during
  execution.
- Keying compatibility by workspace id keeps the shared-resource model simple
  and makes conflicts diagnosable without introducing per-flow override rules.
- Warning on startup preserves operator visibility while avoiding a full runtime
  outage for one bad workspace id.
