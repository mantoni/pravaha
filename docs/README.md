# Docs

- `contracts/`: Canonical executable contracts grouped by topic.
- `flows/`: Checked-in root flow definitions grouped by topic.
- `tasks/<contract-slug>/`: Decomposed execution units for one contract.
- `tasks/untracked/`: Temporary holding area for tasks that still need a
  `Tracked in` relation.
- `decisions/`: Durable workflow and product decisions grouped by topic.
- `conventions/`: Repository and workflow conventions.
- `reference/`: Stable product and domain reference material.
- `plans/repo/<version>/`: Repo evolution plans for changing Pravaha itself. Use
  `v<major>.<minor>` version directories such as `v0.1` and `v1.0`.

- Keep the `docs/` root thin. Put workflow meaning in front matter and
  relations, not in root-level special cases.
