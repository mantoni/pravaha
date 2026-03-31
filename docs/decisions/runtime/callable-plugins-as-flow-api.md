---
Kind: decision
Id: callable-plugins-as-flow-api
Status: accepted
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Callable Plugins As Flow API

- Make imported plugins the official checked-in JavaScript flow API.
- Export `defineFlow(...)` and bundled core plugins from `pravaha/flow`.
- Export bundled core plugins from their modules as named values instead of
  default exports remapped by `pravaha/flow`.
- Call imported plugins directly as `await plugin(ctx, with)`.
- Keep `definePlugin(...)` as one artifact that serves both plugin modules and
  callable flow values.
- Preserve current plugin execution semantics for direct flow calls, including
  parsed `with`, bound `doc`, `failRun(...)`, approval suspension, queue-wait
  suspension, and `dispatchFlow(...)`.
- Import repo-local and third-party plugins through ordinary ECMAScript module
  specifiers instead of Pravaha-owned `local/*` and `npm/*` namespaces.
- Remove flow-facing namespace resolution policy such as `core/*`, `local/*`,
  and `npm/*` from the JavaScript flow authoring surface.
- Stop requiring the main `pravaha` package export in checked-in flow modules.

## Example Shape

```js
import {
  approve,
  defineFlow,
  run,
  runCodex,
  worktreeHandoff,
} from 'pravaha/flow';

export default defineFlow({
  async main(ctx) {
    await run(ctx, { command: 'npm ci' });
    await runCodex(ctx, { prompt: 'Draft a plan.' });
    await approve(ctx, {
      title: 'Approve implementation',
      data: {
        approved_prompt: 'Ship it',
      },
      message: 'Review the implementation.',
      options: ['approve'],
    });
  },

  async onApprove(ctx, data) {
    await worktreeHandoff(ctx, {
      branch: `review/ready/${data.approved_prompt}`,
    });
  },
});
```

## Rationale

- Direct plugin imports remove the remaining translation layer between the code
  flow authors write and the plugin machinery Pravaha actually executes.
- One callable plugin artifact avoids designing and teaching separate runtime
  and flow-facing plugin APIs.
- Ordinary ESM imports keep repo-local and package plugin authoring aligned with
  standard JavaScript instead of preserving a Pravaha-specific resolver that no
  longer adds value.
- Exporting bundled core plugins from `pravaha/flow` keeps the flow authoring
  surface explicit without forcing flow code through the main package entry.
