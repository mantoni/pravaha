---
Kind: task
Id: move-repo-level-tests-into-test
Status: done
Tracked in: docs/contracts/workflow/move-repo-level-tests-into-test.md
Implements: docs/contracts/workflow/move-repo-level-tests-into-test.md
Decided by: docs/decisions/architecture/move-repo-level-tests-into-test.md
---

# Move Repo-Level Tests Into Test

- Move the remaining root-level repo tests into `test/`.
- Update relative imports, URL lookups, and repo-root discovery after the move.
- Tighten layout assertions so the package root stays free of repo-level test
  files.
