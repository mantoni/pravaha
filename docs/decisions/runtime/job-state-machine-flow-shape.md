---
Kind: decision
Id: job-state-machine-flow-shape
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Job State-Machine Flow Shape

- Replace ordered `steps` lists and `needs` barriers with one durable
  single-chain job state machine for flows migrated to this slice.
- Keep root-level `on` bindings as the only fan-out surface. Each matched
  trigger document creates one durable flow instance that advances through one
  job chain.
- Treat each non-terminal `jobs.<name>` entry as one executable node that
  declares exactly one `uses` target plus optional `with`, optional `limits`,
  and required `next`.
- Treat terminal `jobs.<name>` entries as `end` nodes. Terminal nodes do not
  declare `uses`, `with`, `limits`, or `next`.
- Evaluate one node visit at a time for the current flow instance. A completed
  visit yields typed plugin outputs that become the data surface for `next`.
- Make `next` the only control-flow surface inside the durable chain.
- Allow `next` as either one unconditional target name or an ordered branch list
  whose entries declare `goto` and optional `if`.
- Evaluate `next` branches in declaration order and take the first matching
  branch.
- Require each completed node visit to choose exactly one successor or one
  terminal `end`. Do not allow intra-instance fan-out, joins, or parallel
  branches.
- Allow loops by routing `next` back to an earlier job in the same durable
  chain.
- Treat recoverable outcomes as ordinary plugin data rather than as engine
  failure. `next` may branch on the current node result and on the latest
  outputs of previously visited jobs.
- Define `jobs.<name>.outputs` as the latest completed visit for that job in the
  current flow instance.
- Keep plugin result properties typed and machine-readable so validation and
  `next` evaluation can reason over the checked-in flow without plugin-specific
  ad hoc conventions.
- Remove engine-level `await`, `transition`, and `relate` from flows migrated to
  this slice. Express approvals, waits, checked-in workflow mutations,
  notifications, and other interaction mechanics through ordinary plugins such
  as `core/approval`.
- Keep `limits` node-local. `limits.max-visits` caps how many times one job may
  be revisited within the same durable flow instance before the runtime treats
  the instance as terminal failure.
- Move workspace policy to one flow-level `workspace` block that applies to the
  entire durable chain rather than to individual jobs.
- Require `workspace.id`, `workspace.source`, and `workspace.materialize` to
  declare the checked-in workspace contract explicitly.
- Support these first workspace shapes:
  - `source.kind: repo` plus `materialize.kind: worktree` plus
    `materialize.mode: ephemeral` creates a new worktree for the instance.
  - `source.kind: repo` plus `materialize.kind: worktree` plus
    `materialize.mode: pooled` reuses a durable pooled worktree.
  - `source.kind: remote` plus `materialize.kind: checkout` creates a checkout
    from a remote source.
  - `source.kind: bare` plus `materialize.kind: checkout` creates a checkout
    from a local bare repository.
- Keep one flow instance bound to one resolved workspace materialization at a
  time so loops such as `fix -> test -> fix` naturally reuse the same working
  copy.
- Supersede the ordered-step and `needs` execution model for flows migrated to
  the job state-machine surface.

## Rationale

- One executable node per job keeps the durable runtime model legible: enter a
  node, run one plugin, inspect typed outputs, and choose one next node.
- Root-level trigger fan-out preserves the scheduler boundary around one
  leaseable workflow subject per durable instance instead of reintroducing
  hidden concurrency inside the flow body.
- Treating recoverable outcomes as data keeps retry and approval loops explicit
  in checked-in control flow rather than splitting behavior between flow logic
  and hidden engine failure paths.
- Moving waits, approvals, and workflow mutation mechanics into plugins keeps
  the core flow language small while preserving room for richer behavior through
  typed plugin contracts.
- Flow-level workspace policy matches the durable-chain execution model better
  than per-node workspace rules and keeps repeated visits in the same operator-
  visible working copy.
