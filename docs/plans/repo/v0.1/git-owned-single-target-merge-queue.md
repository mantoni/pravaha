---
Kind: plan
Id: git-owned-single-target-merge-queue
Status: active
Depends on:
  - docs/contracts/runtime/git-owned-single-target-merge-queue.md
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
  - docs/contracts/runtime/bundled-core-plugins-and-codex-exec.md
  - docs/reference/runtime/git-owned-merge-queue.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Git-Owned Single-Target Merge Queue Plan

## Goal

- Add a Git-native merge queue to Pravaha that can admit reviewed branch refs,
  validate a single target-branch queue tip, and return success or failure to
  waiting flows while keeping operator pull and publish actions explicit.

## Scope

- Add a repo-level `queue` config section with sensible defaults.
- Add `pravaha queue init`, `pravaha queue sync`, `pravaha queue pull`, and
  `pravaha queue publish`.
- Add a bare queue repo bootstrap path under `.pravaha/queue.git`.
- Add Node hook installation and queue-ref policy enforcement.
- Add Git primitives for ordered queue admission, candidate reconstruction,
  validation, adoption pruning, and upstream publication.
- Add one bundled `core/queue-handoff` plugin and paused-run resume semantics
  for queue success and failure.
- Add optional dispatch coordination so `queue sync` can run a configured queue
  validation flow through workers.
- Add operator-facing docs and fixtures for the queue topology.

## Acceptance

- Repos can initialize a merge queue from config or defaults without changing
  normal local Git remote or pull setup.
- Explicit branch refs can be queued under `refs/queue/ready/*`.
- `pravaha queue sync` can rebuild and validate the queue tip without publishing
  upstream.
- `pravaha queue pull` can adopt the queue tip into the current branch and prune
  only adopted queue entries.
- `pravaha queue publish` can publish the queue tip upstream and prune only
  adopted queue entries.
- Queue validation can remain Git-only or optionally dispatch a configured flow.
- A flow using `core/queue-handoff` pauses until the queued branch leaves the
  queue and then resumes with success or failure.
- Additive feature. No automatic migration of local Git remotes or branch
  tracking.

## Sequencing

- Phase 1: Config and bootstrap
  - Add queue config parsing and defaults.
  - Add `pravaha queue init`.
  - Create the bare queue repository and install Node hooks.
- Phase 2: Queue Git engine
  - Add ordered ready-ref admission and candidate reconstruction.
  - Add queue sync semantics and validated queue-tip updates.
  - Add explicit pull and publish adoption flows with reachability-based prune.
- Phase 3: Runtime handoff
  - Add `core/queue-handoff`.
  - Persist enough queue wait bookkeeping to resume paused runs.
  - Route queue rejection and adoption outcomes back to the waiting run.
- Phase 4: Optional validation flow
  - Add queue config for one optional validation flow.
  - Let `queue sync` dispatch or wake workers for validation flow execution.
  - Keep Git-only queue operation available when no validation flow is
    configured.
- Phase 5: Docs and hardening
  - Add CLI help, examples, and topology docs.
  - Tighten tests around queue refs, pruning, and paused-run resumption.
