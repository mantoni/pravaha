---
Kind: decision
Id: codex-sdk-happy-path-backend
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Codex SDK Happy Path Backend

- Use the Codex SDK as the only worker integration for the first executable
  runtime slice in `v0.1`.
- Shape that slice as a hard-coded happy path that leases one ready task,
  prepares one worktree, invokes one SDK-backed worker run, observes completion,
  and projects one explicit task outcome.
- Require the runtime to pass explicit working-directory context and
  deterministic prompt input into the SDK call.
- Require the runtime to observe success and failure as explicit outcomes and
  project them back into checked-in workflow state.
- Keep the first slice focused on invoke-and-observe semantics and defer generic
  flow interpretation, multi-task scheduling, backend abstraction, and
  repository-edit quality.
- Project success to semantic `review` and project failure to semantic `blocked`
  in the first slice.

## Rationale

- The Codex SDK validates the worker boundary we currently intend to keep
  instead of optimizing around a CLI integration we may discard.
- A hard-coded happy path proves the real lifecycle seams earlier than a generic
  reconciler or interpreter.
- Explicit working-directory and prompt control keep the first worker run
  reproducible and debuggable.
- Explicit success and failure projection preserve durable workflow truth even
  though execution state stays machine-local.
- Using `review` and `blocked` as the first outcome states keeps successful runs
  visible to humans and failed runs visible to operators.
