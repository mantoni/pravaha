---
Kind: reference
Id: pravaha
Status: active
---

# Pravaha

Pravaha turns human workflow into explicit contracts that agents can execute.

Pravaha is a workflow automation engine built on top of
[`patram`](https://github.com/mantoni/patram). It helps humans and agents
collaborate without hard-coding one workflow into the tool.

Humans define the contract: intent, decisions, inputs, outputs, side effects,
invariants, failure modes, and review gates. Agents execute against that
contract by implementing changes and integrating results.

Pravaha centers on a small set of primitives so each team can define its own
workflow. Implementations can change. The contract is what keeps the work
understandable, reviewable, and automatable.
