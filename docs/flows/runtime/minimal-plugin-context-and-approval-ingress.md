---
Kind: flow
Id: minimal-plugin-context-and-approval-ingress
Status: active
---

# Minimal Plugin Context And Approval Ingress

This root flow captures the narrow runtime slice where plugins receive a small
stable `context` contract and may pause one plugin-backed step through
`context.requestApproval()` until the operator resumes that run through
`pravaha approve --token <run_id>`.

```yaml
kind: flow
id: minimal-plugin-context-and-approval-ingress
status: active
scope: contract

jobs:
  wait_within_one_plugin_step:
    select: $class == task and tracked_in == @document and status == ready
    worktree:
      mode: named
      slot: castello
    steps:
      - uses: local/request-approval
      - if: $class == $signal and kind == approval_granted and subject == task
        transition:
          to: review
```
