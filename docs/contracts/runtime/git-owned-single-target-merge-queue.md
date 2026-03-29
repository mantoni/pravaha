---
Kind: contract
Id: git-owned-single-target-merge-queue
Status: proposed
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
Depends on:
  - docs/contracts/runtime/local-dispatch-runtime.md
  - docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
  - docs/contracts/runtime/bundled-core-plugins-and-codex-exec.md
  - docs/reference/runtime/git-owned-merge-queue.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Git-Owned Single-Target Merge Queue

## Intent

- Add an explicit Git-native merge queue to Pravaha that can validate reviewed
  branch refs, keep queue state in a local bare repository, and hand queue
  outcomes back to waiting flows without mutating local Git defaults.

## Inputs

- The accepted Git-owned merge-queue decision.
- The current CLI command surface and repo-level config loading.
- The current bundled core plugin model and run snapshot persistence.
- The current local dispatch runtime for optional worker-backed validation flow
  execution.
- The proposed queue topology in the runtime reference.

## Outputs

- One `pravaha queue` command group with `init`, `sync`, `pull`, and `publish`.
- One repo-level `queue` config section with defaults for the local bare queue
  repository, target branch, queue refs, and optional validation flow.
- Default queue bootstrap that creates `.pravaha/queue.git` and installs
  Node-based hook scripts without changing `origin` or branch tracking.
- A Git ref topology where the bare queue repository is the source of truth for
  queue order and validated integration state.
- Queue commands that can:
  - admit explicit branch refs under `refs/queue/ready/*`
  - rebuild a validated queue tip
  - run optional flow-backed validation
  - explicitly integrate the queue tip into the current branch
  - explicitly publish the queue tip upstream
  - prune ready refs only after success or explicit rejection
- One bundled `core/queue-handoff` plugin that enqueues a branch ref, pauses the
  current run, and resumes it when the queue item leaves the queue.
- Runtime bookkeeping that maps a queued ready ref back to the paused run that
  is waiting for success or failure.

## Side Effects

- Pravaha creates and manages a bare repository under `.pravaha/queue.git` by
  default.
- `pravaha queue sync` may fetch the configured upstream remote and update
  internal queue refs in the bare repository.
- `pravaha queue sync` may wake or dispatch workers when a validation flow is
  configured.
- `pravaha queue pull` may merge or fast-forward the validated queue tip into
  the operator's current branch.
- `pravaha queue publish` may push the validated queue tip to the configured
  upstream target branch.

## Invariants

- The bare queue repository's refs remain the authoritative queue state.
- The first slice supports one queue and one target branch per repo.
- Queue admission is branch-ref based only.
- `pravaha queue init` does not rename remotes, rewrite `branch.*` config, or
  change default `git pull` behavior.
- `pravaha queue sync` never publishes upstream implicitly.
- `pravaha queue pull` and `pravaha queue publish` are explicit operator
  commands.
- A ready ref is removed only after:
  - the queued branch head is proven reachable from the current branch after
    `queue pull`
  - the queued branch head is proven reachable from the upstream target branch
    after `queue publish`
  - the queue rejects the item and reports failure back to the waiting run
- Optional flow-backed validation remains optional. Without configured flow
  validation, the queue still performs Git-only merge applicability and queue
  candidate construction.
- Queue runtime bookkeeping is limited to correlating queue entries with paused
  runs and queue outcomes.
- Hook scripts in the bare queue repo are implemented as Node scripts.

## Failure Modes

- Queue state becomes split between Git refs and runtime records so operators
  cannot explain or repair the queue with ordinary Git inspection.
- `pravaha queue init` silently rewrites local Git defaults.
- `pravaha queue sync` publishes or prunes queue entries without an explicit
  operator action.
- `pravaha queue pull` or `pravaha queue publish` removes a ready ref without
  proving that the queued branch is now reachable from the adopted branch tip.
- Queue failure cannot be correlated back to the paused flow that submitted the
  entry.
- Optional queue validation flow becomes mandatory for basic queue operation.
- Hook policy can only be expressed as shell scripts instead of Node modules.

## Review Gate

- Pravaha help and CLI parsing expose `pravaha queue init`,
  `pravaha queue sync`, `pravaha queue pull`, and `pravaha queue publish`.
- Default queue config targets `.pravaha/queue.git` and keeps local remotes and
  tracking untouched.
- Queue refs are sufficient to inspect ready items, current validated queue tip,
  and last fetched upstream base.
- Explicit branch refs can be enqueued and correlated with paused queue-handoff
  runs.
- `pravaha queue sync` performs Git-only validation by default and can run an
  optional configured validation flow through the worker runtime.
- `pravaha queue pull` and `pravaha queue publish` each prune only the ready
  refs whose branch tips were actually adopted.
- Queue rejection resumes the waiting run with failure.
- Queue adoption through pull or publish resumes the waiting run with success.
- `npm run all` passes.
