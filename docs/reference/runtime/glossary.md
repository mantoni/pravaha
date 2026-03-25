---
Kind: reference
Id: runtime-glossary
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Runtime Glossary

## Terms

| Term           | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Contract       | The portable workflow document that expresses intent, constraints, review gates, and the root flow reference |
| Flow           | A YAML Patram document that defines Pravaha jobs and steps                                                   |
| Root work item | The durable document that owns a flow instance, bound as `document`                                          |
| Leaseable unit | The durable document class that may be acquired for execution when semantically ready                        |
| Job            | A named unit of flow execution that may fan out across selected durable documents                            |
| Step           | One operation within a job, such as `uses`, `run`, `await`, `transition`, or `relate`                        |
| Runtime node   | A machine-local Patram-style node such as `$signal` or `$worker`                                             |
| Mixed graph    | The query model that combines durable repository documents with machine-local runtime nodes                  |
| Worktree       | A git checkout slot used to isolate one leased document at a time                                            |
| Worker         | One supervised local Codex run tied to a leased document and worktree                                        |
| Signal         | A runtime event used by `if` and `await` expressions                                                         |
| Semantic state | A scheduler-facing meaning such as `ready`, `review`, or `done`, mapped onto repository status values        |
