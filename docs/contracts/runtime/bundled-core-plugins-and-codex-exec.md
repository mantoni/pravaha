---
Kind: contract
Id: bundled-core-plugins-and-codex-exec
Status: proposed
Decided by:
  - docs/decisions/runtime/bundled-core-plugins-own-implementations.md
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
  - docs/decisions/runtime/minimal-curated-plugin-context.md
Depends on:
  - docs/contracts/runtime/plugin-backed-ordered-step-execution.md
  - docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md
  - docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Bundled Core Plugins And Codex Exec

## Intent

- Make bundled `core/*` step handlers real plugin modules and replace the
  SDK-backed Codex path with one bundled `core/run-codex` plugin that launches
  `codex exec`.

## Inputs

- The completed plugin-backed ordered step execution slice.
- The proposed minimal plugin context slice with `dispatchFlow(...)`.
- Accepted decisions for pluggable plugins, bundled core plugin ownership, and
  the minimal curated plugin context.

## Outputs

- Runtime plugin loading that resolves `core/<name>` to bundled plugin modules
  exporting `default definePlugin({...})`.
- Removal of placeholder core plugin definitions whose behavior lives in
  separate runtime switch statements.
- Removal of `core/agent` and `core/codex-sdk` from the checked-in flow surface.
- One bundled `core/run-codex` plugin with typed `with` inputs such as `prompt`
  and `reasoning`.
- Runtime and package changes that remove the `@openai/codex-sdk` dependency.
- Bundled `core/run`, `core/run-codex`, `core/approval`, `core/git-status`,
  generic `core/git-merge`, `core/git-squash`, `core/git-rebase`,
  publish-oriented `core/worktree-merge`, `core/worktree-squash`,
  `core/worktree-rebase`, `core/worktree-handoff`, and `core/flow-dispatch`
  plugins implemented as actual modules.

## Side Effects

- Existing checked-in flows using removed core plugins fail until migrated.
- Bundled core plugin behavior becomes inspectable in the same way as other
  plugin modules rather than being hidden in runtime dispatch code.
- Codex execution semantics such as prompt shaping, output filtering, and final
  result formatting become plugin-owned behavior.

## Invariants

- `core/*` remains the public checked-in namespace for bundled step plugins.
- Bundled core plugins use the same public plugin contract as local and npm
  plugins.
- `core/git-*` remains generic local Git porcelain over the current checkout.
- `core/worktree-*` publishes the current worktree `HEAD` into explicit repo
  branches without mutating the worktree during merge, squash, or rebase
  publication.
- Pravaha does not expose a general process-launch helper on plugin `context`.
- Bundled plugins may launch OS subprocesses directly as ordinary plugin
  implementation detail.
- `context.dispatchFlow({...})` remains the explicit runtime-native helper for
  downstream flow handoff.
- `core/run` and `core/run-codex` may use different plugin-local `with` shapes.
- `core/run-codex` does not accept arbitrary argv passthrough in this slice.

## Failure Modes

- `core/*` still resolves to placeholder definitions whose behavior lives in a
  separate runtime switch statement.
- `@openai/codex-sdk` remains part of the runtime path for bundled Codex
  execution.
- Bundled core plugins receive privileged runtime-only context fields that
  repo-local plugins cannot access.
- Pravaha grows a general process-launch API on plugin `context` instead of
  keeping subprocess policy plugin-owned.
- `core/run-codex` becomes a thin argv passthrough wrapper rather than a typed
  bundled Codex integration.
- `core/worktree-*` mutates the checked-out worktree during failed publish
  attempts instead of keeping it as read-only publish input.

## Review Gate

- `core/<name>` plugins load through bundled modules and the ordinary plugin
  contract.
- `core/agent` and `core/codex-sdk` are removed from validation examples,
  runtime examples, and loader support.
- `core/run-codex` launches `codex exec` without the SDK dependency.
- `context.dispatchFlow({...})` is available without widening `context` into a
  general process API.
- `npm run all` passes.
