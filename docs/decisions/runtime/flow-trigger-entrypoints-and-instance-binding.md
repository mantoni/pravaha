---
Kind: decision
Id: flow-trigger-entrypoints-and-instance-binding
Status: accepted
Tracked in: docs/plans/repo/v0.1/local-dispatch-runtime.md
---

# Flow Trigger Entrypoints And Instance Binding

- Replace `jobs.<name>.select` as the top-level scheduling primitive for
  dispatched flows with a root-level `on` map.
- In the first dispatch slice, require exactly one durable trigger binding per
  root flow in the form `on.<binding>.where`.
- Bind the matched durable document by the `on` key name for the whole flow
  instance.
- Create one flow instance per matched trigger document and treat that bound
  flow instance as the scheduler and worker assignment unit.
- Keep `if`, `await`, `transition`, `relate`, `uses`, and `run` inside jobs and
  steps. Jobs no longer fan out durable work through their own `select` queries.
- Keep flow entrypoints anchored to durable checked-in workflow documents and
  reject runtime-class triggers in `on.*.where`.
- Preserve the flow root binding as `document` for contract-scoped expressions
  and add the trigger binding alongside it.

## Rationale

- Dispatcher-owned scheduling needs one stable durable unit of work that can be
  leased, retried, observed, and rediscovered after crashes.
- A root-level trigger makes the work source explicit instead of hiding it
  inside the first runnable job.
- One trigger binding per flow keeps validation, instance identity, and retry
  semantics legible in the first dispatcher-backed slice.
- Keeping jobs narrow avoids a second layer of worker-visible fan-out after the
  dispatcher has already chosen the durable work instance.
