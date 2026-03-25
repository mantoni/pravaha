---
Kind: convention
Id: repo-plan-versioning
Status: active
---

# Repo Plan Versioning

- Use `v<major>.<minor>` directory names for repo evolution plans.
- Treat the version as a milestone line such as `v0.1`, `v0.2`, or `v1.0`.
- Do not use major-only plan directories such as `v0` or `v1`.
- Do not use patch-level plan directories such as `v0.1.1`.
- Keep one plan file per change inside the milestone directory.

## Examples

```text
docs/plans/repo/
  v0.1/
    semantic-contract-workflow.md
    north-star.md
  v0.2/
    contract-execution-cli.md
  v1.0/
    stable-agent-runtime.md
```
