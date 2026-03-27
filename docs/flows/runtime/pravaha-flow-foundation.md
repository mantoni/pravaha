---
Kind: flow
Id: pravaha-flow-foundation
Status: active
---

# Pravaha Flow Foundation

This root flow anchors the repository model surface for the Pravaha runtime
contract until runtime execution lands.

```yaml
on:
  task:
    where: $class == task and tracked_in == @document and status == ready

jobs:
  validate-foundation:
    steps:
      - run: npm run all
```
