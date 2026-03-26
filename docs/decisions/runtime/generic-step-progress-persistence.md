---
Kind: decision
Id: generic-step-progress-persistence
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Generic Step Progress Persistence

- Persist step progress generically for all ordered job steps in `v0.1`.
- Treat all step kinds under one execution model instead of giving plugin-backed
  steps a separate persistence rule.
- Record the current step position so Pravaha can resume from the first
  incomplete step after interruption or restart.
- Do not re-run steps that already completed successfully for the current run.
- Keep plugin and command steps idempotent because retries may still occur
  before a step is recorded as complete.
- Resume unresolved runs from the recorded incomplete step instead of
  re-entering the whole job from the beginning.

## Rationale

- Generic step persistence keeps the runtime model simpler than introducing one
  persistence path for plugin-backed steps and another for everything else.
- Resuming from the recorded incomplete step avoids repeated side effects after
  successful step completion.
- Keeping idempotency expectations in place still protects the system against
  crashes or retries that happen before step completion is durably recorded.
