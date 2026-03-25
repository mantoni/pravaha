---
Kind: reference
Id: codex-backend-evaluation
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Codex Backend Evaluation

This document captures the evaluation frame for the first Codex backend.

## Current Constraint

- `v0.1` should support exactly one Codex backend.
- The primary selection criterion is strong local lifecycle control rather than
  minimum integration effort.
- Workers are run-to-completion processes, not interactive sessions.

## Evaluation Criteria

```json
{
  "criteria": [
    "can be launched and supervised as a local child process",
    "runs in one prepared worktree with explicit cwd control",
    "stdout and stderr are observable by Pravaha",
    "exit status is observable by Pravaha",
    "cancellation is possible without fragile process hunting",
    "fits run-to-completion worker semantics",
    "works with reusable named worktrees",
    "supports prompt and asset injection deterministically"
  ]
}
```

## Candidate Shape

```json
{
  "candidates": ["codex exec", "codex cloud", "Codex SDK or app-server"]
}
```

## Comparison Frame

| Candidate         | Local lifecycle control                 | Observability                                         | Run-to-completion fit       | Notes                                                                                         |
| ----------------- | --------------------------------------- | ----------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `codex exec`      | Strong if launched directly by Pravaha  | Strong if stdout, stderr, and exit status are exposed | Strong                      | Current leading candidate because it aligns with direct local supervision                     |
| `codex cloud`     | Weaker because execution is more remote | Potentially weaker or indirect                        | Depends on remote run model | More likely to trade local control for convenience                                            |
| SDK or app-server | Potentially strong                      | Potentially strong                                    | Potentially strong          | Worth evaluating only if it preserves local supervision without adding unnecessary complexity |

## Recommendation Shape

The first backend choice should be recorded against these criteria:

```json
{
  "selected_backend": "TBD",
  "reasons": [
    "local child-process supervision",
    "observable completion and failure",
    "clean worktree-local execution model"
  ]
}
```
