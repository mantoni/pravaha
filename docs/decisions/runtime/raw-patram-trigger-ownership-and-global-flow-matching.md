---
Kind: decision
Id: raw-patram-trigger-ownership-and-global-flow-matching
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Raw Patram Trigger Ownership And Global Flow Matching

- Remove `semantic_roles` and `semantic_states` from `pravaha.json`.
- Make flow trigger queries, flow expressions, and runtime dispatch speak raw
  Patram classes and statuses directly.
- Replace the root-level `on` trigger map with one required `on.patram` query
  string.
- Treat `on.patram` as a pure Patram query over checked-in documents with no
  special query bindings such as `@document`.
- Keep static flow validation against `.patram.json` and require `on.patram` to
  constrain `$class` to exactly one non-runtime Patram class.
- Discover dispatchable flows only from configured glob matches and remove the
  `root_flow` convention entirely.
- Evaluate every discovered flow against the project graph globally with no
  additional repo-level dispatch gate outside the flow query itself.
- Treat the selected trigger document as the durable owner of the run and derive
  flow-instance identity from the flow path and owner document id.
- Expose the owner document in flow expressions and flow or plugin context only
  as `doc`.
- Remove the class-named trigger binding and remove the task-shaped runtime
  contract.
- Keep this trigger model document-only in this slice and do not add a generic
  runtime `subject` abstraction.
- Treat multiple flow files that match the same owner document as a
  configuration error that fails dispatch and schedules none of the matching
  flows.
- Keep terminal flow-instance rerun suppression keyed by the flow-instance
  tracking record. If the owner document still matches after a terminal run,
  warn and do not rerun it implicitly.
- Allow operators to reset that suppression barrier by removing the
  corresponding flow-instance tracking record.
- Supersede the earlier contract-scoped trigger and matching assumptions from
  `flow-trigger-entrypoints-and-instance-binding`,
  `default-flow-matching-and-configurable-contract-flow-label`, and
  `semantic-role-config-and-state-model`.

## Rationale

- Removing the semantic mapping layer keeps Pravaha aligned with the repository
  model instead of maintaining a second vocabulary for the same classes and
  statuses.
- A single `on.patram` query makes flow applicability explicit without adding a
  second naming surface for trigger bindings.
- Global flow discovery through configured globs removes the split between
  explicit contract attachment and fallback matching.
- Using the selected document as the owner of the run preserves a durable unit
  for identity, resume, and rerun suppression after `root_flow` and contract
  binding are removed.
- Exposing one stable owner binding keeps the runtime API predictable across
  different Patram classes without forcing JavaScript flows or plugins to
  recover a dynamic property name from the trigger query.
- Preserving static validation and ambiguity failures keeps flow errors visible
  before or during dispatch instead of turning them into silent empty-match
  behavior.
