---
Kind: decision
Id: git-owned-single-target-merge-queue
Status: accepted
Tracked in: docs/plans/repo/v0.1/git-owned-single-target-merge-queue.md
---

# Git-Owned Single-Target Merge Queue

- Add one explicit `pravaha queue` command group with `init`, `sync`, `pull`,
  and `publish` subcommands.
- Keep queue truth in Git refs inside one local bare queue repository. Pravaha
  runtime state may track waiting runs, but it must not become the authoritative
  queue ordering or integration ledger.
- Default the bare queue repository to `.pravaha/queue.git`.
- Keep the first slice to one configured queue per repo and one configured
  target branch.
- Keep the admission artifact to one explicit branch ref. The queue does not
  accept anonymous worktree snapshots or raw commit hashes in the first slice.
- Keep local Git setup explicit. `pravaha queue init` must not rename `origin`,
  rewrite branch upstream tracking, or change normal `git pull` behavior.
- Make `pravaha queue sync` responsible for Git-native queue validation and
  queue-tip rebuilding. By default this means fetch, merge applicability, and
  candidate reconstruction only.
- Keep `pravaha queue publish` as the only command that pushes queue state to
  the configured upstream target branch.
- Keep `pravaha queue pull` as the explicit command that integrates the current
  validated queue tip into the operator's current branch.
- Let a queue entry leave `refs/queue/ready/*` only when:
  - `pravaha queue pull` proves the queued branch head is now reachable from the
    current branch and prunes the ready ref.
  - `pravaha queue publish` proves the queued branch head is now reachable from
    the published upstream target branch and prunes the ready ref.
  - `pravaha queue sync` rejects the item because it cannot be merged or its
    configured validation flow fails, and Pravaha hands failure back to the
    waiting run.
- Support one optional configured queue validation flow. When configured,
  `pravaha queue sync` may dispatch the flow through workers and use the result
  as CI for the candidate tip. When not configured, queue behavior remains
  Git-only.
- Use Node-based hook scripts inside the bare queue repository for validation
  and guardrails.
- Add one bundled `core/queue-handoff` plugin that enqueues an explicit branch
  ref into the queue and pauses the current run until the queued item leaves the
  queue with success or failure.

## Rationale

- Git refs are a good fit for queue ordering, merge applicability, and
  integration replay because they stay debuggable with ordinary Git tooling.
- A single queue and target branch keeps the initial CLI, config, and ref
  topology legible.
- Explicit branch refs match the reviewed-branch workflow already present in
  Pravaha and avoid introducing a second branch-capture mechanism.
- Requiring explicit `pull` and `publish` preserves operator control and avoids
  surprising local branch or remote mutations.
- Optional flow-backed validation lets Pravaha act as CI without forcing the
  queue to depend on the worker pool for basic Git-only operation.
- Queue runtime bookkeeping should exist only to resume paused flows, not to
  replace Git as the source of truth for queue state.
