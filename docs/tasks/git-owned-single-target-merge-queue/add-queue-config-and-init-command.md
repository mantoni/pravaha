---
Kind: task
Id: add-queue-config-and-init-command
Status: done
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Add Queue Config And Init Command

- Extend repo config loading and validation to accept one `queue` section with
  defaults for:
  - `dir`
  - `upstream_remote`
  - `target_branch`
  - `ready_ref_prefix`
  - `candidate_ref`
  - `base_ref`
  - optional `validation_flow`
- Add `pravaha queue init` to create the bare queue repository when missing.
- Seed the queue repo from the configured upstream target branch.
- Install Node-based hook scripts into the queue repo.
- Keep local remotes, branch upstream tracking, and default `git pull` behavior
  unchanged.
